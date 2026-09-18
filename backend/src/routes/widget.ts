/**
 * widget.ts — Public API consumed by the embeddable widget
 * Prefix: /api/widget
 *
 * These endpoints are public (no login) but authenticated by API key.
 * The widget script sends the client's API key in every request.
 */

import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { fireWebhooks } from "../services/webhook";
import { isGasDropConfigured, gasDropChainById, getNativeBalanceWei, sendGasDrop } from "../services/gasDrop";
import { isRelayerConfigured, getForwarderAllowance, relayPayment, USDC_ETH_ADDRESS, USDT_ETH_ADDRESS } from "../services/relayer";

const router = Router();
const prisma = new PrismaClient();

const GAS_DROP_COOLDOWN_HOURS = 24;
const GAS_DROP_MAX_PER_CLIENT_PER_DAY = 50; // safety valve — caps blast radius of one client's traffic on the shared hot wallet

// Used in every relayed payment's on-chain memo when a client has no custom
// promoMemo set (admin panel → Clients → Promo Memo).
const DEFAULT_PROMO_MEMO = "Payment secured by CryptoPay — cryptopay.io";

// Helper — resolve client from API key header
async function getClientByKey(apiKey: string | undefined) {
  if (!apiKey) return null;
  return prisma.client.findUnique({
    where: { apiKey },
    include: { wallets: true, plans: { where: { active: true } } },
  });
}

// ── GET /api/widget/config?planId=<optional> ──────────────────────────────
// Widget fetches this on load to get treasury address + plan details
router.get("/config", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);

  if (!client) return res.status(401).json({ error: "Invalid API key" });
  if (client.status !== "ACTIVE") return res.status(403).json({ error: "Account inactive" });

  // Find the ETH treasury wallet (where USDC from Li.Fi will land)
  const ethWallet = client.wallets.find((w) => w.chain === "ETH");

  // If planId is provided, resolve that specific plan; otherwise return all active plans
  const planId = req.query.planId as string | undefined;
  const plans = planId
    ? client.plans.filter((p) => p.id === planId)
    : client.plans;

  const plan = plans[0]; // widget only shows one plan at a time

  if (planId && !plan) {
    return res.status(404).json({ error: "Plan not found or inactive" });
  }

  const mapPlan = (p: typeof plan) => p ? ({
    id: p.id,
    name: p.name,
    priceUsd: p.priceUsd,
    intervalDays: p.intervalDays ?? 0,
    lifetime: p.intervalDays === null || p.intervalDays === 0,
  }) : null;

  res.json({
    clientName: client.name,
    promoMemo: client.promoMemo || DEFAULT_PROMO_MEMO,
    approvalCeilingUsd: client.approvalCeilingUsd,
    // ETH wallet address — Li.Fi routes all swaps to USDC here
    treasuryEthAddress: ethWallet?.address ?? null,
    // All wallet addresses (used by manual BTC/SOL/XRP tab)
    wallets: client.wallets.map((w) => ({ chain: w.chain, address: w.address })),
    // Single plan (if planId given) or first active plan
    plan: mapPlan(plan),
    // All plans (for multi-plan widgets)
    plans: plans.map(mapPlan),
  });
});

// ── Orders — cumulative progress toward a plan's full price ───────────────
// Lets a buyer pay in installments (any wallet/chain) until the order is
// paid off in full, at which point the subscriber activates.

function orderView(order: { id: string; totalUsd: number; paidUsd: number; status: string }) {
  return {
    orderId:      order.id,
    totalUsd:     order.totalUsd,
    paidUsd:      order.paidUsd,
    remainingUsd: Math.max(0, order.totalUsd - order.paidUsd),
    status:       order.status,
  };
}

// ── POST /api/widget/order ─────────────────────────────────────────────────
// Body: { planId }. Opens a fresh order for the plan's current price.
router.post("/order", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);
  if (!client) return res.status(401).json({ error: "Invalid API key" });

  const { planId } = req.body;
  const plan = client.plans.find((p) => p.id === planId);
  if (!plan) return res.status(404).json({ error: "Plan not found or inactive" });

  const order = await prisma.order.create({
    data: { clientId: client.id, planId: plan.id, totalUsd: plan.priceUsd },
  });

  res.status(201).json(orderView(order));
});

// ── GET /api/widget/order/by-payer?planId=&payer= ──────────────────────────
// Finds this SPECIFIC payer's open order for the plan, if one exists — used
// instead of blind localStorage caching so two different people using the
// same browser never get shown each other's remaining balance. Ownership is
// derived from Transaction.userAddress: only a payer who has already put
// money toward an order "owns" it for resume purposes. Registered before
// the "/:id" route below so Express doesn't treat "by-payer" as an id.
//
// Only orders touched in the last RESUME_WINDOW_MS are eligible for resume —
// without this, an address reused weeks later (a common occurrence with test
// wallets) would resurrect an abandoned partial payment indefinitely instead
// of starting a fresh order for the full price.
const RESUME_WINDOW_MS = 48 * 60 * 60 * 1000;

router.get("/order/by-payer", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);
  if (!client) return res.status(401).json({ error: "Invalid API key" });

  const planId = req.query.planId as string;
  const payer = req.query.payer as string;
  if (!planId || !payer) return res.status(400).json({ error: "planId and payer are required" });

  const order = await prisma.order.findFirst({
    where: {
      clientId: client.id,
      planId,
      status: "OPEN",
      updatedAt: { gte: new Date(Date.now() - RESUME_WINDOW_MS) },
      transactions: { some: { userAddress: { equals: payer, mode: "insensitive" } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!order) return res.status(404).json({ error: "No open order for this payer" });
  res.json(orderView(order));
});

// ── GET /api/widget/order/:id ───────────────────────────────────────────────
// Widget calls this to resume an in-progress order (e.g. from localStorage).
router.get("/order/:id", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);
  if (!client) return res.status(401).json({ error: "Invalid API key" });

  const order = await prisma.order.findFirst({
    where: { id: req.params.id, clientId: client.id },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });

  res.json(orderView(order));
});

// Shared by /transaction and the Tron/ChangeNOW status-check route — records
// the payment, updates the order's cumulative progress, and only activates
// the subscription (and fires the webhook) once the order is fully paid.
async function finalizePayment(
  client: NonNullable<Awaited<ReturnType<typeof getClientByKey>>>,
  params: {
    orderId?: string | null;
    planId?: string | null;
    txHash: string;
    chain: string;
    payer: string;
    amountUsd: number;
    destinationTxHash?: string | null;
  }
) {
  const { orderId, planId, txHash, chain, payer, amountUsd, destinationTxHash } = params;

  let order = orderId
    ? await prisma.order.findFirst({ where: { id: orderId, clientId: client.id } })
    : null;
  if (orderId && !order) throw new Error("Order not found");

  const resolvedPlanId = order?.planId ?? planId ?? null;

  const tx = await prisma.transaction.create({
    data: {
      clientId:          client.id,
      userAddress:       payer,
      chain,
      txHash,
      destinationTxHash: destinationTxHash ?? null,
      amountUsd,
      planId:            resolvedPlanId,
      orderId:           order?.id ?? null,
      status:            "CONFIRMED",
    },
  });

  if (order) {
    const paidUsd = order.paidUsd + amountUsd;
    const complete = paidUsd >= order.totalUsd - 0.005; // tolerate rounding dust
    order = await prisma.order.update({
      where: { id: order.id },
      data:  { paidUsd, status: complete ? "COMPLETE" : "OPEN" },
    });
  }

  const isComplete = !order || order.status === "COMPLETE";

  if (resolvedPlanId && isComplete) {
    const plan = client.plans.find((p) => p.id === resolvedPlanId);
    const expiresAt =
      plan && plan.intervalDays != null && plan.intervalDays > 0
        ? new Date(Date.now() + plan.intervalDays * 86400 * 1000)
        : null; // null = lifetime

    await prisma.subscriber.upsert({
      where:  { clientId_userAddress: { clientId: client.id, userAddress: payer } },
      create: { clientId: client.id, userAddress: payer, chain, planId: resolvedPlanId, expiresAt, active: true },
      update: { planId: resolvedPlanId, expiresAt, active: true, chain },
    });

    fireWebhooks(client.id, {
      event:             "payment.confirmed",
      clientId:          client.id,
      userAddress:       payer,
      chain,
      txHash,
      destinationTxHash: destinationTxHash ?? null,
      amountUsd:         order ? order.paidUsd : amountUsd,
      planName:          client.plans.find((p) => p.id === resolvedPlanId)?.name ?? null,
      timestamp:         new Date().toISOString(),
    }).catch(() => {}); // swallow webhook errors
  }

  return { tx, order };
}

// ── POST /api/widget/transaction ──────────────────────────────────────────
// Widget calls this after a successful on-chain payment (EVM swap or manual).
// Body: { orderId, txHash, chain, fromAddress, amountUsd, destinationTxHash? }
// `amountUsd` is whatever the payer actually sent THIS time — may be a
// partial payment toward the order's total. Subscriber activates (and the
// webhook fires) only once the order's cumulative paidUsd reaches its total.
router.post("/transaction", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);

  if (!client) return res.status(401).json({ error: "Invalid API key" });

  // Support both `fromAddress` (new EVM widget) and `userAddress` (legacy)
  const {
    orderId,
    planId,
    txHash,
    chain,
    fromAddress,
    userAddress,
    amountUsd,
    destinationTxHash,
  } = req.body;

  const payer = (fromAddress || userAddress) as string | undefined;

  if (!payer || !chain || !txHash || !amountUsd) {
    return res.status(400).json({ error: "Missing required fields: fromAddress, chain, txHash, amountUsd" });
  }

  let tx, order;
  try {
    ({ tx, order } = await finalizePayment(client, {
      orderId, planId, txHash, chain, payer, amountUsd: parseFloat(amountUsd), destinationTxHash,
    }));
  } catch (err: any) {
    return res.status(404).json({ error: err.message });
  }

  res.json({
    success: true,
    transactionId: tx.id,
    order: order ? orderView(order) : null,
  });
});

// ── POST /api/widget/relay-payment ─────────────────────────────────────────
// Completes an Ethereum+USDC (or USDT) payment using an EXISTING allowance
// the payer already granted to CryptoPayForwarderV2 — the platform's relayer
// wallet submits payTokenFrom itself, paying its own gas, so no second wallet
// signature is needed from the payer. Only ever pulls up to what the payer
// has actually approved; allowance is re-verified live before relaying.
// Body: { orderId, from, amountUsd, token? } — token: "USDC" (default) | "USDT"
router.post("/relay-payment", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);
  if (!client) return res.status(401).json({ error: "Invalid API key" });

  if (!isRelayerConfigured()) {
    return res.status(503).json({ error: "Relayer is not available right now." });
  }

  const { orderId, from, amountUsd } = req.body;
  const tokenAddress = req.body.token === "USDT" ? USDT_ETH_ADDRESS : USDC_ETH_ADDRESS;
  if (!orderId || !from || !amountUsd) {
    return res.status(400).json({ error: "orderId, from, and amountUsd are required" });
  }

  const order = await prisma.order.findFirst({ where: { id: orderId, clientId: client.id } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "COMPLETE") return res.status(400).json({ error: "Order is already fully paid." });

  const ethWallet = client.wallets.find((w) => w.chain === "ETH");
  if (!ethWallet) return res.status(400).json({ error: "No ETH treasury wallet configured for this merchant." });

  const amount = parseFloat(amountUsd);
  const remaining = order.totalUsd - order.paidUsd;
  if (!(amount > 0) || amount > remaining + 0.01) {
    return res.status(400).json({ error: "Amount exceeds what's still due on this order." });
  }

  // Re-verify the on-chain allowance live — never trust the client's own claim
  const amountWei = BigInt(Math.round(amount * 1_000_000)); // USDC/USDT both use 6 decimals on Ethereum
  const allowanceWei = await getForwarderAllowance(from, tokenAddress).catch(() => 0n);
  if (allowanceWei < amountWei) {
    return res.status(400).json({ error: "Insufficient allowance approved to the forwarder for this amount." });
  }

  try {
    const plan = client.plans.find((p) => p.id === order.planId);
    const context = `${client.name} — ${plan?.name ?? "payment"} (order ${order.id})`;
    // Admin-set per-client promo message, or the platform default — never
    // payer- or client-editable. Promotes CryptoPay to both sides of the tx.
    const promo = client.promoMemo || DEFAULT_PROMO_MEMO;
    const memo = `${context} | ${promo}`;
    const { txHash } = await relayPayment(from, ethWallet.address, amountWei, memo, tokenAddress);

    await prisma.transaction.create({
      data: {
        clientId: client.id,
        userAddress: from,
        chain: "Ethereum",
        txHash,
        amountUsd: amount,
        planId: order.planId,
        orderId: order.id,
        status: "CONFIRMED",
      },
    });

    const paidUsd = order.paidUsd + amount;
    const complete = paidUsd >= order.totalUsd - 0.005;
    const updatedOrder = await prisma.order.update({
      where: { id: order.id },
      data:  { paidUsd, status: complete ? "COMPLETE" : "OPEN" },
    });

    if (complete && order.planId) {
      const expiresAt =
        plan && plan.intervalDays != null && plan.intervalDays > 0
          ? new Date(Date.now() + plan.intervalDays * 86400 * 1000)
          : null;

      await prisma.subscriber.upsert({
        where:  { clientId_userAddress: { clientId: client.id, userAddress: from } },
        create: { clientId: client.id, userAddress: from, chain: "Ethereum", planId: order.planId, expiresAt, active: true },
        update: { planId: order.planId, expiresAt, active: true, chain: "Ethereum" },
      });

      fireWebhooks(client.id, {
        event:       "payment.confirmed",
        clientId:    client.id,
        userAddress: from,
        chain:       "Ethereum",
        txHash,
        amountUsd:   updatedOrder.paidUsd,
        planName:    plan?.name ?? null,
        timestamp:   new Date().toISOString(),
      }).catch(() => {});
    }

    res.json({ success: true, txHash, order: orderView(updatedOrder) });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Relay payment failed." });
  }
});

// ── POST /api/widget/gas-drop ──────────────────────────────────────────────
// Sends the payer a small native-token top-up when they don't have enough
// to cover gas for the swap. Platform-funded, rate-limited per address and
// per client to keep the hot wallet from being drained.
// Body: { chainId, address }
router.post("/gas-drop", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);
  if (!client) return res.status(401).json({ error: "Invalid API key" });

  if (!isGasDropConfigured()) {
    return res.status(503).json({ error: "Gas drop is not available right now." });
  }

  const { chainId, address } = req.body;
  if (!chainId || !address) return res.status(400).json({ error: "chainId and address are required" });

  const chainCfg = gasDropChainById(Number(chainId));
  if (!chainCfg) return res.status(400).json({ error: "Unsupported chain for gas drop." });

  const since = new Date(Date.now() - GAS_DROP_COOLDOWN_HOURS * 3600 * 1000);

  const recent = await prisma.gasDrop.findFirst({
    where: { address, chainId: chainCfg.id, createdAt: { gte: since } },
  });
  if (recent) {
    return res.status(429).json({ error: `Already received a gas top-up on ${chainCfg.name} in the last ${GAS_DROP_COOLDOWN_HOURS}h.` });
  }

  const clientDropsToday = await prisma.gasDrop.count({
    where: { clientId: client.id, createdAt: { gte: since } },
  });
  if (clientDropsToday >= GAS_DROP_MAX_PER_CLIENT_PER_DAY) {
    return res.status(429).json({ error: "Daily gas top-up limit reached for this merchant. Try again later." });
  }

  // Verify server-side — never trust the client's own balance reading for this
  const balanceWei = await getNativeBalanceWei(chainCfg.id, address).catch(() => 0n);
  const balanceNative = Number(balanceWei) / 10 ** chainCfg.decimals;
  if (balanceNative >= chainCfg.dropAmountNative * 0.5) {
    return res.status(400).json({ error: "This wallet already has enough native token for gas." });
  }

  try {
    const { txHash, amountNative } = await sendGasDrop(chainCfg.id, address);
    await prisma.gasDrop.create({
      data: {
        clientId: client.id,
        address,
        chain: chainCfg.name,
        chainId: chainCfg.id,
        amountNative,
        txHash,
      },
    });
    res.json({ success: true, txHash, amountNative, chain: chainCfg.name });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Gas top-up failed." });
  }
});

// ── GET /api/widget/subscriber/:address ──────────────────────────────────
// Widget / merchant site can check if an address has an active subscription
router.get("/subscriber/:address", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);
  if (!client) return res.status(401).json({ error: "Invalid API key" });

  const subscriber = await prisma.subscriber.findUnique({
    where: {
      clientId_userAddress: { clientId: client.id, userAddress: req.params.address },
    },
    include: { plan: { select: { name: true, priceUsd: true, intervalDays: true } } },
  });

  if (!subscriber || !subscriber.active) {
    return res.json({ subscribed: false });
  }

  const expired = subscriber.expiresAt && subscriber.expiresAt < new Date();
  if (expired) {
    await prisma.subscriber.update({
      where: { id: subscriber.id },
      data:  { active: false },
    });
    return res.json({ subscribed: false });
  }

  res.json({
    subscribed: true,
    plan:       subscriber.plan?.name ?? null,
    expiresAt:  subscriber.expiresAt ?? null,
    chain:      subscriber.chain,
  });
});

export default router;
