/**
 * admin.ts — Routes only the platform owner can access
 * Prefix: /api/admin
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { adminAuth, AdminRequest } from "../middleware/adminAuth";
import { GAS_DROP_CHAINS, isGasDropConfigured, getGasDropAddress, getNativeBalanceWei } from "../services/gasDrop";
import { isRelayerConfigured, getRelayerAddress, FORWARDER_V2_ADDRESS } from "../services/relayer";
import { isTronRelayerConfigured, getTronRelayerAddress, getTronRelayerBalance, FORWARDER_TRON_ADDRESS } from "../services/tron";

const router = Router();
const prisma = new PrismaClient();

const priceCache: { data: Record<string, number>; ts: number } = { data: {}, ts: 0 };
async function getGasDropPrices(): Promise<Record<string, number>> {
  if (Date.now() - priceCache.ts < 60_000) return priceCache.data;
  const ids = [...new Set(GAS_DROP_CHAINS.map((c) => c.coingeckoId))].join(",");
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
    const json = await res.json() as Record<string, { usd: number }>;
    const data: Record<string, number> = {};
    for (const id of Object.keys(json)) data[id] = json[id].usd;
    priceCache.data = data;
    priceCache.ts = Date.now();
    return data;
  } catch {
    return priceCache.data; // stale is better than nothing
  }
}

// ── POST /api/admin/login ──────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ adminId: admin.id }, process.env.ADMIN_JWT_SECRET!, { expiresIn: "12h" });
  res.json({ token, name: admin.name, email: admin.email });
});

// ── GET /api/admin/stats ───────────────────────────────────────────────────
router.get("/stats", adminAuth, async (_req, res) => {
  const [totalClients, activeClients, totalTransactions, totalSubscribers] = await Promise.all([
    prisma.client.count(),
    prisma.client.count({ where: { status: "ACTIVE" } }),
    prisma.transaction.count({ where: { status: "CONFIRMED" } }),
    prisma.subscriber.count({ where: { active: true } }),
  ]);

  // Total revenue across all clients
  const revenueResult = await prisma.transaction.aggregate({
    _sum: { amountUsd: true },
    where: { status: "CONFIRMED" },
  });

  res.json({
    totalClients,
    activeClients,
    totalTransactions,
    totalSubscribers,
    totalRevenueUsd: revenueResult._sum.amountUsd ?? 0,
  });
});

// ── GET /api/admin/clients ─────────────────────────────────────────────────
router.get("/clients", adminAuth, async (req, res) => {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true, name: true, email: true, status: true, plan: true,
      website: true, apiKey: true, createdAt: true, promoMemo: true,
      wallets: true,
      _count: { select: { subscribers: true, transactions: true } },
    },
  });
  res.json(clients);
});

// ── GET /api/admin/clients/:id ─────────────────────────────────────────────
router.get("/clients/:id", adminAuth, async (req, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.params.id },
    include: {
      wallets:      true,
      plans:        true,
      transactions: { orderBy: { createdAt: "desc" }, take: 50 },
      subscribers:  { orderBy: { createdAt: "desc" }, take: 50 },
      webhooks:     true,
    },
  });
  if (!client) return res.status(404).json({ error: "Client not found" });

  // Strip password
  const { password: _, ...safe } = client as typeof client & { password: string };
  res.json(safe);
});

// ── PATCH /api/admin/clients/:id/status ────────────────────────────────────
router.patch("/clients/:id/status", adminAuth, async (req, res) => {
  const { status } = req.body;
  if (!["ACTIVE", "SUSPENDED", "PENDING"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data:  { status },
    select: { id: true, name: true, status: true },
  });
  res.json(client);
});

// ── PATCH /api/admin/clients/:id/plan ──────────────────────────────────────
router.patch("/clients/:id/plan", adminAuth, async (req, res) => {
  const { plan } = req.body;
  if (!["STARTER", "GROWTH", "ENTERPRISE"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data:  { plan },
    select: { id: true, name: true, plan: true },
  });
  res.json(client);
});

// ── PATCH /api/admin/clients/:id/promo-memo ────────────────────────────────
// Admin-only. Recorded on-chain with every relayed payment for this client
// (alongside the auto order context) to promote CryptoPay to both the payer
// and the merchant. Never editable by the client or the payer themselves.
router.patch("/clients/:id/promo-memo", adminAuth, async (req, res) => {
  const { promoMemo } = req.body;
  if (promoMemo !== null && typeof promoMemo !== "string") {
    return res.status(400).json({ error: "promoMemo must be a string or null" });
  }

  function sanitize(input: string): string {
    let out = "";
    for (const ch of input) {
      const code = ch.codePointAt(0)!;
      if (code >= 0x20 && code !== 0x7f) out += ch;
    }
    return out.trim().slice(0, 140);
  }

  const cleaned = promoMemo === null ? null : (sanitize(promoMemo) || null);

  const client = await prisma.client.update({
    where: { id: req.params.id },
    data:  { promoMemo: cleaned },
    select: { id: true, name: true, promoMemo: true },
  });
  res.json(client);
});

// ── DELETE /api/admin/clients/:id ──────────────────────────────────────────
router.delete("/clients/:id", adminAuth, async (req, res) => {
  await prisma.client.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── GET /api/admin/transactions ────────────────────────────────────────────
router.get("/transactions", adminAuth, async (req, res) => {
  const page  = parseInt(req.query.page as string)  || 1;
  const limit = parseInt(req.query.limit as string) || 50;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      skip:    (page - 1) * limit,
      take:    limit,
      orderBy: { createdAt: "desc" },
      include: { client: { select: { id: true, name: true } }, plan: { select: { name: true } } },
    }),
    prisma.transaction.count(),
  ]);

  res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
});

// ── GET /api/admin/gas-drop ─────────────────────────────────────────────────
// Hot wallet visibility: public address, live per-chain balances, recent
// drop activity. Never exposes the private key — that stays SSH-only.
router.get("/gas-drop", adminAuth, async (_req, res) => {
  const address = getGasDropAddress();
  if (!address) {
    return res.json({ configured: false, address: null, balances: [], recentDrops: [] });
  }

  const prices = await getGasDropPrices();

  const balances = await Promise.all(
    GAS_DROP_CHAINS.map(async (c) => {
      try {
        const wei = await getNativeBalanceWei(c.id, address);
        const balanceNative = Number(wei) / 10 ** c.decimals;
        const price = prices[c.coingeckoId] ?? 0;
        return {
          chainId: c.id, chainName: c.name, symbol: c.symbol,
          balanceNative, balanceUsd: balanceNative * price,
          dropAmountNative: c.dropAmountNative,
          dropsRemaining: Math.floor(balanceNative / c.dropAmountNative),
        };
      } catch {
        return {
          chainId: c.id, chainName: c.name, symbol: c.symbol,
          balanceNative: null, balanceUsd: null,
          dropAmountNative: c.dropAmountNative, dropsRemaining: null,
        };
      }
    })
  );

  const recentDrops = await prisma.gasDrop.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { client: { select: { name: true } } },
  });

  const [totalDrops, dropsLast24h] = await Promise.all([
    prisma.gasDrop.count(),
    prisma.gasDrop.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
  ]);

  // Relayer wallet — separate key from the gas-drop wallet, pays gas to
  // complete Ethereum+USDC payments via the CryptoPayForwarderV2 contract.
  let relayer = null;
  const relayerAddress = getRelayerAddress();
  if (relayerAddress) {
    const wei = await getNativeBalanceWei(1, relayerAddress).catch(() => null);
    const ethPrice = prices["ethereum"] ?? 0;
    relayer = {
      configured: true,
      address: relayerAddress,
      forwarderContract: FORWARDER_V2_ADDRESS,
      balanceEth: wei !== null ? Number(wei) / 1e18 : null,
      balanceUsd: wei !== null ? (Number(wei) / 1e18) * ethPrice : null,
    };
  } else {
    relayer = { configured: false, address: null };
  }

  // Tron relayer wallet — receives ChangeNOW's USDT-TRC20 payout, then
  // forwards it to the client's wallet via CryptoPayForwarderTron.
  let tronRelayer = null;
  const tronRelayerAddress = getTronRelayerAddress();
  if (tronRelayerAddress) {
    const balanceSun = await getTronRelayerBalance().catch(() => null);
    let trxPrice = 0;
    try {
      const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd");
      const json = (await res.json()) as { tron?: { usd: number } };
      trxPrice = json.tron?.usd ?? 0;
    } catch {}
    const balanceTrx = balanceSun !== null ? Number(balanceSun) / 1_000_000 : null;
    tronRelayer = {
      configured: true,
      address: tronRelayerAddress,
      forwarderContract: FORWARDER_TRON_ADDRESS,
      balanceTrx,
      balanceUsd: balanceTrx !== null ? balanceTrx * trxPrice : null,
    };
  } else {
    tronRelayer = { configured: false, address: null };
  }

  res.json({ configured: true, address, balances, recentDrops, totalDrops, dropsLast24h, relayer, tronRelayer });
});

export default router;
