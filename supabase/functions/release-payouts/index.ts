// Pays hosts for past happs. Run it hourly (Supabase cron) with the header
// `x-cron-secret: <CRON_SECRET>`.
//
// A ticket's money goes to the host 24 hours after the happ starts (once the
// refund window has long closed): the price minus the 13% platform fee, as a
// transfer to their Stripe account. Hosts who haven't finished payout setup
// are skipped and paid on a later run once they have. Also lets go of spots
// held by payments that never finished.
import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, errorResponse, HttpError, PAYOUT_DELAY_HOURS, stripe } from "../_shared/stripe.ts";

type Due = {
  id: string;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  stripe_charge_id: string;
  happ_id: string;
  happs: { creator_id: string; starts_at: string; cancelled_at: string | null } | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) throw new HttpError(401, "Unauthorized");

    const db = admin();
    const cutoff = new Date(Date.now() - PAYOUT_DELAY_HOURS * 3600_000).toISOString();

    // Spots held for payments that never finished.
    const { data: stale } = await db
      .from("tickets")
      .update({ status: "expired" })
      .eq("status", "reserved")
      .lt("reserved_until", new Date(Date.now() - 3600_000).toISOString())
      .select("stripe_payment_intent_id");
    for (const t of stale ?? []) {
      if (t.stripe_payment_intent_id) await stripe().paymentIntents.cancel(t.stripe_payment_intent_id).catch(() => undefined);
    }

    const { data: due, error } = await db
      .from("tickets")
      .select("id, amount_cents, platform_fee_cents, currency, stripe_charge_id, happ_id, happs!inner(creator_id, starts_at, cancelled_at)")
      .eq("status", "valid")
      .is("transferred_at", null)
      .not("stripe_charge_id", "is", null)
      .lt("happs.starts_at", cutoff)
      .is("happs.cancelled_at", null)
      .limit(500);
    if (error) throw error;

    const accounts = new Map<string, string | null>();
    let paid = 0;
    let waiting = 0;
    for (const t of (due ?? []) as unknown as Due[]) {
      const host = t.happs?.creator_id;
      if (!host) continue;
      if (!accounts.has(host)) accounts.set(host, await payableAccount(db, host));
      const destination = accounts.get(host);
      if (!destination) {
        waiting++;
        continue;
      }
      try {
        const transfer = await stripe().transfers.create(
          {
            amount: t.amount_cents - t.platform_fee_cents,
            currency: t.currency,
            destination,
            source_transaction: t.stripe_charge_id,
            transfer_group: `happ_${t.happ_id}`,
            metadata: { ticket_id: t.id, happ_id: t.happ_id },
          },
          { idempotencyKey: `transfer-${t.id}` },
        );
        await db
          .from("tickets")
          .update({ stripe_transfer_id: transfer.id, transferred_at: new Date().toISOString() })
          .eq("id", t.id);
        paid++;
      } catch (err) {
        console.error("Transfer failed for ticket", t.id, err);
      }
    }
    return json({ paid, waiting_for_host_setup: waiting, released_holds: stale?.length ?? 0 });
  } catch (err) {
    return errorResponse(err);
  }
});

/** The host's Stripe account if it can receive money right now. */
async function payableAccount(db: ReturnType<typeof admin>, userId: string) {
  const { data } = await db.from("stripe_accounts").select("stripe_account_id").eq("user_id", userId).maybeSingle();
  if (!data) return null;
  const account = await stripe().accounts.retrieve(data.stripe_account_id);
  await db
    .from("stripe_accounts")
    .update({
      details_submitted: account.details_submitted,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
    })
    .eq("user_id", userId);
  return account.capabilities?.transfers === "active" ? account.id : null;
}
