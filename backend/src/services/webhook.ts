/**
 * webhook.ts
 * Delivers signed webhook payloads to client endpoints
 * when a payment is confirmed.
 */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export type WebhookEvent = {
  event:       "payment.confirmed" | "subscription.activated" | "subscription.expired";
  clientId:    string;
  userAddress: string;
  chain:       string;
  txHash:      string;
  amountUsd:   number;
  planName?:   string;
  timestamp:   string;
};

/**
 * Fire all active webhooks for a client.
 * Signs the payload with HMAC-SHA256 using the webhook's secret.
 * The client verifies this signature on their server.
 */
export async function fireWebhooks(clientId: string, event: WebhookEvent) {
  const webhooks = await prisma.webhook.findMany({
    where: { clientId, active: true },
  });

  const payload = JSON.stringify(event);

  for (const wh of webhooks) {
    try {
      const signature = crypto
        .createHmac("sha256", wh.secret)
        .update(payload)
        .digest("hex");

      await fetch(wh.url, {
        method:  "POST",
        headers: {
          "Content-Type":        "application/json",
          "X-CryptoPay-Sig":     signature,
          "X-CryptoPay-Event":   event.event,
          "X-CryptoPay-Version": "1",
        },
        body: payload,
        signal: AbortSignal.timeout(10_000), // 10 second timeout
      });

      console.log(`✓ Webhook fired to ${wh.url} for client ${clientId}`);
    } catch (err) {
      console.error(`✗ Webhook failed for ${wh.url}:`, err);
      // Don't throw — webhook failure shouldn't block the main flow
    }
  }
}
