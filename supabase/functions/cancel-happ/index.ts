// A host cancels their happ: { happ_id } -> { refunded, deleted }
//
// Every paid ticket is refunded in full and payments still in progress are
// stopped. A happ that never sold anything is simply deleted; one with
// tickets is marked cancelled (off the map) so the records stay.
import { corsHeaders, json } from "../_shared/cors.ts";
import { admin, errorResponse, HttpError, readJson, refundTicket, requireUser, stripe } from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = admin();
    const user = await requireUser(req, db);
    const { happ_id } = await readJson<{ happ_id?: string }>(req);
    if (!happ_id) throw new HttpError(400, "Which happ?");

    const { data: happ } = await db.from("happs").select("id, creator_id").eq("id", happ_id).maybeSingle();
    if (!happ) throw new HttpError(404, "Happ not found");
    if (happ.creator_id !== user.id) throw new HttpError(403, "Only the host can cancel this happ");

    const { data: tickets } = await db
      .from("tickets")
      .select("id, status, stripe_payment_intent_id, stripe_transfer_id")
      .eq("happ_id", happ.id);

    if (!tickets?.length) {
      const { error } = await db.from("happs").delete().eq("id", happ.id);
      if (error) throw error;
      return json({ refunded: 0, deleted: true });
    }

    // Stop sales first, then refund.
    await db.from("happs").update({ cancelled_at: new Date().toISOString(), is_active: false }).eq("id", happ.id);

    let refunded = 0;
    const failures: string[] = [];
    for (const t of tickets) {
      try {
        if (t.status === "valid") {
          await refundTicket(db, t, "happ_cancelled");
          refunded++;
        } else if (t.status === "reserved") {
          if (t.stripe_payment_intent_id) {
            await stripe().paymentIntents.cancel(t.stripe_payment_intent_id).catch(() => undefined);
          }
          await db.from("tickets").update({ status: "expired" }).eq("id", t.id);
        }
      } catch (err) {
        console.error("Refund failed for ticket", t.id, err);
        failures.push(t.id);
      }
    }
    if (failures.length) {
      throw new HttpError(502, `Cancelled, but ${failures.length} refund(s) failed; try again`, { refunded });
    }
    return json({ refunded, deleted: false });
  } catch (err) {
    return errorResponse(err);
  }
});
