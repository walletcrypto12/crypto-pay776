/**
 * admin.ts — Routes only the platform owner can access
 * Prefix: /api/admin
 */

import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { adminAuth, AdminRequest } from "../middleware/adminAuth";

const router = Router();
const prisma = new PrismaClient();

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
    include: {
      _count: { select: { subscribers: true, transactions: true } },
      wallets: true,
    },
    select: {
      id: true, name: true, email: true, status: true, plan: true,
      website: true, apiKey: true, createdAt: true,
      _count: true, wallets: true,
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

export default router;
