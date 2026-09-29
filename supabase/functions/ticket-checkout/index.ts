// Start buying a ticket: { happ_id } -> { client_secret, ticket_id, amount_cents, currency }
//
// Holds a spot for 15 minutes and creates a Stripe PaymentIntent the app pays
// in its own sheet (Apple Pay / Google Pay / card). The ticket becomes valid
// when Stripe confirms the payment (stripe-webhook). The buyer pays The Happs;
// the host's share is transferred after the event (release-payouts).
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  admin,
  errorResponse,
  HttpError,
  platformFee,
  readJson,
  requireUser,
  RESERVE_MINUTES,
  stripe,
} from "../_shared/stripe.ts";

type Happ = {
  id: string;
  name: string;
  creator_id: string;
  price_cents: number;
  currency: string;
  capacity: number | null;
  starts_at: string;
  last_activity_at: string;
  is_active: boolean;
  cancelled_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = admin();
    const user = await requireUser(req, db);
    const { happ_id } = await readJson<{ happ_id?: string }>(req);
    if (!happ_id) throw new HttpError(400, "Which happ?");

    const { data: happ } = await db
      .from("happs")
      .select("id, name, creator_id, price_cents, currency, capacity, starts_at, last_activity_at, is_active, cancelled_at")
      .eq("id", happ_id)
      .maybeSingle<Happ>();
    if (!happ) throw new HttpError(404, "This happ has ended");
    if (happ.price_cents <= 0) throw new HttpError(400, "This happ is free");
    if (happ.cancelled_at) throw new HttpError(410, "This happ was cancelled");
    if (happ.creator_id === user.id) throw new HttpError(400, "You're the host");
    const started = Date.parse(happ.starts_at) <= Date.now();
    const quiet = Date.now() - Date.parse(happ.last_activity_at) > 2 * 3600_000;
    if (started && (!happ.is_active || quiet)) throw new HttpError(410, "This happ has ended");

    // Already have one? Pick up where you left off, or say you're in.
    const { data: existing } = await db
      .from("tickets")
      .select("id, status, reserved_until, stripe_payment_intent_id")
      .eq("happ_id", happ.id)
      .eq("user_id", user.id)
      .in("status", ["reserved", "valid"])
      .maybeSingle();
    if (existing?.status === "valid") {
      throw new HttpError(409, "You already have a ticket", { ticket_id: existing.id });
    }
    if (existing && Date.parse(existing.reserved_until) > Date.now() && existing.stripe_payment_intent_id) {
      const intent = await stripe().paymentIntents.retrieve(existing.stripe_payment_intent_id);
      if (intent.status !== "canceled" && intent.status !== "succeeded") {
        return json({
          client_secret: intent.client_secret,
          ticket_id: existing.id,
          amount_cents: happ.price_cents,
          currency: happ.currency,
        });
      }
    }
    if (existing) {
      // A stale hold: let it go before starting again.
      await db.from("tickets").update({ status: "expired" }).eq("id", existing.id);
    }

    // Hold a spot, then make sure it's really there.
    const { data: ticket, error } = await db
      .from("tickets")
      .insert({
        happ_id: happ.id,
        user_id: user.id,
        amount_cents: happ.price_cents,
        platform_fee_cents: platformFee(happ.price_cents),
        currency: happ.currency,
        reserved_until: new Date(Date.now() + RESERVE_MINUTES * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;

    if (happ.capacity) {
      const { data: taken } = await db.rpc("tickets_taken", { p_happ_id: happ.id });
      if (typeof taken === "number" && taken > happ.capacity) {
        await db.from("tickets").update({ status: "expired" }).eq("id", ticket.id);
        throw new HttpError(409, "Sold out");
      }
    }

    const intent = await stripe().paymentIntents.create(
      {
        amount: happ.price_cents,
        currency: happ.currency,
        automatic_payment_methods: { enabled: true },
        description: `Ticket: ${happ.name}`.slice(0, 200),
        receipt_email: user.email ?? undefined,
        transfer_group: `happ_${happ.id}`,
        metadata: { ticket_id: ticket.id, happ_id: happ.id, user_id: user.id },
      },
      { idempotencyKey: `ticket-${ticket.id}` },
    );
    await db.from("tickets").update({ stripe_payment_intent_id: intent.id }).eq("id", ticket.id);

    return json({
      client_secret: intent.client_secret,
      ticket_id: ticket.id,
      amount_cents: happ.price_cents,
      currency: happ.currency,
    });
  } catch (err) {
    return errorResponse(err);
  }
});
