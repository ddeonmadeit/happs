// Refund a ticket: { ticket_id } -> { refunded: true }
//
// Buyers get a full refund until 24 hours before the happ starts. Hosts can
// refund any ticket for their own happ at any time.
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  admin,
  errorResponse,
  HttpError,
  readJson,
  refundTicket,
  REFUND_CUTOFF_HOURS,
  requireUser,
} from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = admin();
    const user = await requireUser(req, db);
    const { ticket_id } = await readJson<{ ticket_id?: string }>(req);
    if (!ticket_id) throw new HttpError(400, "Which ticket?");

    const { data: ticket } = await db
      .from("tickets")
      .select("id, user_id, status, stripe_payment_intent_id, stripe_transfer_id, happs(creator_id, starts_at)")
      .eq("id", ticket_id)
      .maybeSingle();
    if (!ticket) throw new HttpError(404, "Ticket not found");
    const happ = ticket.happs as unknown as { creator_id: string; starts_at: string } | null;
    const isHost = happ?.creator_id === user.id;
    if (ticket.user_id !== user.id && !isHost) throw new HttpError(403, "Not your ticket");
    if (ticket.status === "refunded") return json({ refunded: true });
    if (ticket.status !== "valid") throw new HttpError(400, "This ticket wasn't paid for");

    if (!isHost) {
      const cutoff = Date.parse(happ?.starts_at ?? "") - REFUND_CUTOFF_HOURS * 3600_000;
      if (Date.now() > cutoff) {
        throw new HttpError(400, `Refunds close ${REFUND_CUTOFF_HOURS} hours before the happ starts`);
      }
    }

    await refundTicket(db, ticket, isHost ? "host_refund" : "requested_by_customer");
    return json({ refunded: true });
  } catch (err) {
    return errorResponse(err);
  }
});
