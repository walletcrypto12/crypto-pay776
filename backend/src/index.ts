import "dotenv/config";
import express from "express";
import cors    from "cors";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import adminRoutes  from "./routes/admin";
import clientRoutes from "./routes/clients";
import widgetRoutes from "./routes/widget";

const app    = express();
const prisma = new PrismaClient();
const PORT   = process.env.PORT || 4000;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.ADMIN_DASHBOARD_URL  || "http://localhost:3001",
    process.env.CLIENT_DASHBOARD_URL || "http://localhost:3002",
    "*", // widget requests come from any client domain
  ],
  credentials: true,
}));
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.use("/api/admin",  adminRoutes);
app.use("/api/client", clientRoutes);
app.use("/api/widget", widgetRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date() }));

// ── Serve embeddable widget script ─────────────────────────────────────────
import path from "path";
app.use("/widget.js", express.static(path.join(__dirname, "../../widget/dist/widget.js")));

// ── Startup ────────────────────────────────────────────────────────────────
async function main() {
  // Ensure admin account exists
  const adminEmail = process.env.ADMIN_EMAIL || "admin@yourplatform.com";
  const adminPass  = process.env.ADMIN_PASSWORD || "Admin123!";

  const existing = await prisma.admin.findUnique({ where: { email: adminEmail } });
  if (!existing) {
    const hashed = await bcrypt.hash(adminPass, 12);
    await prisma.admin.create({
      data: { email: adminEmail, password: hashed, name: "Platform Admin" },
    });
    console.log(`✓ Admin account created: ${adminEmail}`);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 CryptoPay API running on http://localhost:${PORT}`);
    console.log(`   Admin dashboard: ${process.env.ADMIN_DASHBOARD_URL || "http://localhost:3001"}`);
    console.log(`   Client dashboard: ${process.env.CLIENT_DASHBOARD_URL || "http://localhost:3002"}`);
    console.log(`   Widget script: http://localhost:${PORT}/widget.js\n`);
  });
}

main().catch(console.error);
