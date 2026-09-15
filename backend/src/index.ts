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
// req.protocol can't be trusted here — nginx terminates TLS and proxies
// over plain HTTP without forwarding X-Forwarded-Proto, so req.protocol
// always reports "http" even on the live HTTPS site (this caused embedded
// widget.js calls on the /pay page to hit the wrong scheme and fail).
const PLATFORM_URL = process.env.PLATFORM_URL || `http://localhost:${PORT}`;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
// Each CORS policy is scoped to its own route prefix (not applied globally)
// so a preflight for one never gets short-circuited by another's middleware
// — the `cors` package ends OPTIONS requests itself, so ordering/scoping here
// matters: an unscoped app.use(cors(...)) would intercept every path's
// preflight before route-specific middleware ever runs.

// Dashboards (admin/client) — restricted to their own known origins.
const dashboardCors = cors({
  origin: [
    process.env.ADMIN_DASHBOARD_URL  || "http://localhost:3001",
    process.env.CLIENT_DASHBOARD_URL || "http://localhost:3002",
  ],
  credentials: true,
});
app.use("/api/admin",  dashboardCors, adminRoutes);
app.use("/api/client", dashboardCors, clientRoutes);

// Widget endpoints are embedded on arbitrary client websites, so any origin
// must be allowed here. No cookies are used (auth is the x-api-key header),
// so a fully permissive origin carries no credential-leak risk.
app.use("/api/widget", cors({ origin: true }), widgetRoutes);

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok", timestamp: new Date() }));

// ── Serve embeddable widget script ─────────────────────────────────────────
import path from "path";
app.use("/widget.js", express.static(path.join(__dirname, "../../widget/dist/widget.js")));
// WalletConnect's libraries are large — kept as a separate lazy-loaded chunk
// the widget only fetches if a buyer actually clicks that option.
app.use("/walletconnect-chunk.js", express.static(path.join(__dirname, "../../widget/dist/walletconnect-chunk.js")));

// ── Standalone payment link page ────────────────────────────────────────────
// A merchant-generated shareable URL for a one-off custom amount. This is a
// bare page (no merchant site of their own needed) that loads the exact same
// widget.js and opens it automatically — reusing 100% of the existing
// checkout flow. The API key embedded here is the same one every merchant
// already puts directly in their site's page source for the normal embed
// snippet, so this carries no new exposure.
app.get("/pay/:planId", async (req, res) => {
  const plan = await prisma.subscriptionPlan.findFirst({
    where: { id: req.params.planId, isPaymentLink: true, active: true },
    include: { client: { select: { apiKey: true, name: true } } },
  });
  if (!plan) {
    res.status(404).send("<h1>Payment link not found</h1><p>This link may have been deactivated or removed.</p>");
    return;
  }

  // ?mode=silent lets the same link be tested in either auto-continue mode
  // without a separate link or a redeploy — see widget's AUTO_CONTINUE_MODE.
  const autoContinueMode = req.query.mode === "silent" ? "silent" : "click";

  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Pay ${plan.client.name}</title>
  <style>
    body{margin:0;min-height:100vh;background:#0f172a;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
    .cp-pay-page-header{position:fixed;top:40px;left:0;right:0;text-align:center;color:#94a3b8;font-size:14px}
  </style>
</head>
<body>
  <div class="cp-pay-page-header">${plan.client.name}</div>
  <div id="cp-pay-btn"></div>
  <script
    src="/widget.js"
    data-api-key="${plan.client.apiKey}"
    data-plan-id="${plan.id}"
    data-backend-url="${PLATFORM_URL}"
    data-hide-amount="true"
    data-auto-continue="${autoContinueMode}"
    data-container="cp-pay-btn"
  ></script>
  <script>
    // Auto-open on load — closing it (or a failed payment) still leaves the
    // "Pay with Crypto" button (rendered into #cp-pay-btn by widget.js
    // itself) visible as a way back in, instead of a dead blank page.
    document.addEventListener("DOMContentLoaded", function () { window.CryptoPay.open(); });
  </script>
</body>
</html>`);
});

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
