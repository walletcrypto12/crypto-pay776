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

const router = Router();
const prisma = new PrismaClient();

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

// ── POST /api/widget/transaction ──────────────────────────────────────────
// Widget calls this after a successful on-chain payment (EVM swap or manual)
// Body: { planId, txHash, chain, fromAddress, amountUsd, destinationTxHash? }
router.post("/transaction", async (req, res) => {
  const apiKey = req.headers["x-api-key"] as string;
  const client = await getClientByKey(apiKey);

  if (!client) return res.status(401).json({ error: "Invalid API key" });

  // Support both `fromAddress` (new EVM widget) and `userAddress` (legacy)
  const {
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

  // Record transaction
  const tx = await prisma.transaction.create({
    data: {
      clientId:          client.id,
      userAddress:       payer,
      chain,
      txHash,
      destinationTxHash: destinationTxHash ?? null,
      amountUsd:         parseFloat(amountUsd),
      planId:            planId ?? null,
      status:            "CONFIRMED",
    },
  });

  // Upsert subscriber record when a plan is attached
  if (planId) {
    const plan = client.plans.find((p) => p.id === planId);
    const expiresAt =
      plan && plan.intervalDays != null && plan.intervalDays > 0
        ? new Date(Date.now() + plan.intervalDays * 86400 * 1000)
        : null; // null = lifetime

    await prisma.subscriber.upsert({
      where:  { clientId_userAddress: { clientId: client.id, userAddress: payer } },
      create: { clientId: client.id, userAddress: payer, chain, planId, expiresAt, active: true },
      update: { planId, expiresAt, active: true, chain },
    });
  }

  // Fire client webhooks asynchronously (don't block the response)
  fireWebhooks(client.id, {
    event:             "payment.confirmed",
    clientId:          client.id,
    userAddress:       payer,
    chain,
    txHash,
    destinationTxHash: destinationTxHash ?? null,
    amountUsd:         parseFloat(amountUsd),
    planName:          client.plans.find((p) => p.id === planId)?.name ?? null,
    timestamp:         new Date().toISOString(),
  }).catch(() => {}); // swallow webhook errors

  res.json({ success: true, transactionId: tx.id });
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
