/**
 * clients.ts — Client self-service routes (dashboard API)
 * Prefix: /api/client
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { clientAuth, ClientRequest } from "../middleware/clientAuth";

const router = Router();
const prisma = new PrismaClient();

// ── POST /api/client/register ──────────────────────────────────────────────
router.post("/register", async (req, res) => {
  const { name, email, password, website } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  const existing = await prisma.client.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const hashed = await bcrypt.hash(password, 12);
  const client = await prisma.client.create({
    data: { name, email, password: hashed, website, apiKey: uuidv4() },
    select: { id: true, name: true, email: true, status: true, apiKey: true },
  });

  const token = jwt.sign({ clientId: client.id }, process.env.CLIENT_JWT_SECRET!, { expiresIn: "7d" });
  res.status(201).json({ token, ...client });
});

// ── POST /api/client/login ─────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const client = await prisma.client.findUnique({ where: { email } });
  if (!client) return res.status(401).json({ error: "Invalid credentials" });

  if (client.status === "SUSPENDED") {
    return res.status(403).json({ error: "Account suspended. Contact support." });
  }

  const valid = await bcrypt.compare(password, client.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ clientId: client.id }, process.env.CLIENT_JWT_SECRET!, { expiresIn: "7d" });
  const { password: _, ...safe } = client;
  res.json({ token, ...safe });
});

// ── GET /api/client/me ─────────────────────────────────────────────────────
router.get("/me", clientAuth, async (req: ClientRequest, res) => {
  const client = await prisma.client.findUnique({
    where: { id: req.clientId },
    include: { wallets: true, plans: true, _count: { select: { subscribers: true, transactions: true } } },
  });
  if (!client) return res.status(404).json({ error: "Not found" });
  const { password: _, ...safe } = client;
  res.json(safe);
});

// ── GET /api/client/stats ──────────────────────────────────────────────────
router.get("/stats", clientAuth, async (req: ClientRequest, res) => {
  const [activeSubscribers, totalTransactions, revenueResult, recentTx] = await Promise.all([
    prisma.subscriber.count({ where: { clientId: req.clientId!, active: true } }),
    prisma.transaction.count({ where: { clientId: req.clientId!, status: "CONFIRMED" } }),
    prisma.transaction.aggregate({
      _sum: { amountUsd: true },
      where: { clientId: req.clientId!, status: "CONFIRMED" },
    }),
    prisma.transaction.findMany({
      where:   { clientId: req.clientId! },
      orderBy: { createdAt: "desc" },
      take:    5,
    }),
  ]);

  res.json({
    activeSubscribers,
    totalTransactions,
    totalRevenueUsd: revenueResult._sum.amountUsd ?? 0,
    recentTransactions: recentTx,
  });
});

// ── Wallet addresses ───────────────────────────────────────────────────────

router.get("/wallets", clientAuth, async (req: ClientRequest, res) => {
  const wallets = await prisma.clientWallet.findMany({ where: { clientId: req.clientId! } });
  res.json(wallets);
});

router.post("/wallets", clientAuth, async (req: ClientRequest, res) => {
  const { chain, address } = req.body;
  if (!chain || !address) return res.status(400).json({ error: "Chain and address required" });
  if (!["ETH", "BTC", "SOL", "XRP"].includes(chain)) {
    return res.status(400).json({ error: "Chain must be ETH, BTC, SOL, or XRP" });
  }

  const wallet = await prisma.clientWallet.upsert({
    where:  { clientId_chain: { clientId: req.clientId!, chain } },
    create: { clientId: req.clientId!, chain, address },
    update: { address },
  });
  res.json(wallet);
});

router.delete("/wallets/:chain", clientAuth, async (req: ClientRequest, res) => {
  await prisma.clientWallet.deleteMany({
    where: { clientId: req.clientId!, chain: req.params.chain as "ETH" | "BTC" | "SOL" | "XRP" },
  });
  res.json({ success: true });
});

// ── Subscription plans ─────────────────────────────────────────────────────

router.get("/plans", clientAuth, async (req: ClientRequest, res) => {
  const plans = await prisma.subscriptionPlan.findMany({ where: { clientId: req.clientId! } });
  res.json(plans);
});

router.post("/plans", clientAuth, async (req: ClientRequest, res) => {
  const { name, priceUsd, intervalDays } = req.body;
  if (!name || !priceUsd) return res.status(400).json({ error: "Name and price required" });

  const { features } = req.body;
  const plan = await prisma.subscriptionPlan.create({
    data: { clientId: req.clientId!, name, priceUsd: parseFloat(priceUsd), intervalDays: intervalDays ?? null, features: features ?? null },
  });
  res.status(201).json(plan);
});

router.patch("/plans/:id", clientAuth, async (req: ClientRequest, res) => {
  const { name, priceUsd, intervalDays, active } = req.body;
  const plan = await prisma.subscriptionPlan.updateMany({
    where: { id: req.params.id, clientId: req.clientId! },
    data:  { name, priceUsd: priceUsd ? parseFloat(priceUsd) : undefined, intervalDays, active },
  });
  res.json(plan);
});

router.delete("/plans/:id", clientAuth, async (req: ClientRequest, res) => {
  await prisma.subscriptionPlan.deleteMany({
    where: { id: req.params.id, clientId: req.clientId! },
  });
  res.json({ success: true });
});

// ── Transactions ───────────────────────────────────────────────────────────

router.get("/transactions", clientAuth, async (req: ClientRequest, res) => {
  const page  = parseInt(req.query.page as string)  || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where:   { clientId: req.clientId! },
      skip:    (page - 1) * limit,
      take:    limit,
      orderBy: { createdAt: "desc" },
      include: { plan: { select: { name: true } } },
    }),
    prisma.transaction.count({ where: { clientId: req.clientId! } }),
  ]);

  res.json({ transactions, total, page, pages: Math.ceil(total / limit) });
});

// ── Subscribers ────────────────────────────────────────────────────────────

router.get("/subscribers", clientAuth, async (req: ClientRequest, res) => {
  const page  = parseInt(req.query.page as string)  || 1;
  const limit = parseInt(req.query.limit as string) || 20;

  const [subscribers, total] = await Promise.all([
    prisma.subscriber.findMany({
      where:   { clientId: req.clientId! },
      skip:    (page - 1) * limit,
      take:    limit,
      orderBy: { createdAt: "desc" },
      include: { plan: { select: { name: true } } },
    }),
    prisma.subscriber.count({ where: { clientId: req.clientId! } }),
  ]);

  res.json({ subscribers, total, page, pages: Math.ceil(total / limit) });
});

// ── Webhooks ───────────────────────────────────────────────────────────────

router.get("/webhooks", clientAuth, async (req: ClientRequest, res) => {
  const hooks = await prisma.webhook.findMany({
    where: { clientId: req.clientId! },
    select: { id: true, url: true, active: true, createdAt: true }, // don't expose secret
  });
  res.json(hooks);
});

router.post("/webhooks", clientAuth, async (req: ClientRequest, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });

  const secret = uuidv4().replace(/-/g, ""); // 32 char hex secret
  const hook = await prisma.webhook.create({
    data: { clientId: req.clientId!, url, secret },
  });
  // Return secret ONCE — client must save it
  res.status(201).json({ id: hook.id, url: hook.url, secret, active: hook.active });
});

router.delete("/webhooks/:id", clientAuth, async (req: ClientRequest, res) => {
  await prisma.webhook.deleteMany({ where: { id: req.params.id, clientId: req.clientId! } });
  res.json({ success: true });
});

// ── API key regeneration ───────────────────────────────────────────────────
router.post("/regenerate-key", clientAuth, async (req: ClientRequest, res) => {
  const client = await prisma.client.update({
    where: { id: req.clientId! },
    data:  { apiKey: uuidv4() },
    select: { apiKey: true },
  });
  res.json(client);
});

export default router;
