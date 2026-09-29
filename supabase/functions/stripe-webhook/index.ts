// Stripe tells us what happened to payments and host accounts.
//
// Two endpoints in the Stripe dashboard point here:
//   "Your account": payment_intent.succeeded, payment_intent.canceled, charge.refunded
//   "Connected accounts": account.updated
// Put both signing secrets in STRIPE_WEBHOOK_SECRET, comma-separated.
import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, Stripe, stripe } from "../_shared/stripe.ts";

const WEBHOOK_SECRETS = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const crypto = Stripe.createSubtleCryptoProvider();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!WEBHOOK_SECRETS.length) return json({ error: "Webhook not configured" }, 503);

  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();
  let event: Stripe.Event | null = null;
  for (const secret of WEBHOOK_SECRETS) {
    try {
      event = await stripe().webhooks.constructEventAsync(body, signature ?? "", secret, undefined, crypto);
      break;
    } catch {
      // Signed by the other endpoint's secret (or not by Stripe at all).
    }
  }
  if (!event) {
    console.warn("Bad webhook signature");
    return json({ error: "Invalid signature" }, 400);
  }

  const db = admin();
  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object;
        const charge = typeof intent.latest_charge === "string" ? intent.latest_charge : intent.latest_charge?.id;
        await db
          .from("tickets")
          .update({ status: "valid", paid_at: new Date().toISOString(), stripe_charge_id: charge ?? null })
          .eq("stripe_payment_intent_id", intent.id)
          .in("status", ["reserved", "expired"]);
        break;
      }
      case "payment_intent.canceled": {
        await db
          .from("tickets")
          .update({ status: "expired" })
          .eq("stripe_payment_intent_id", event.data.object.id)
          .eq("status", "reserved");
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object;
        const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
        if (intent && charge.refunded) {
          await db
            .from("tickets")
            .update({ status: "refunded", refunded_at: new Date().toISOString() })
            .eq("stripe_payment_intent_id", intent)
            .neq("status", "refunded");
        }
        break;
      }
      case "account.updated": {
        const account = event.data.object;
        await db
          .from("stripe_accounts")
          .update({
            details_submitted: account.details_submitted,
            charges_enabled: account.charges_enabled,
            payouts_enabled: account.payouts_enabled,
          })
          .eq("stripe_account_id", account.id);
        break;
      }
    }
    return json({ received: true });
  } catch (err) {
    console.error("Webhook handling failed:", event.type, err);
    // A 500 makes Stripe retry later.
    return json({ error: "Failed" }, 500);
  }
});
