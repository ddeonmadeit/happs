// Shared setup for the ticketing functions.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (stripe-webhook),
// CRON_SECRET (release-payouts), optional APP_URL (where Stripe sends hosts
// back to, default the GitHub Pages site) and STRIPE_COUNTRY (default AU).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided by the platform.
import Stripe from "npm:stripe@17.7.0";
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { json } from "./cors.ts";

/** The Happs keeps 13% of each ticket (and pays the card fees out of it). */
export const PLATFORM_FEE_RATE = 0.13;
/** Buyers can refund themselves until this long before the start. */
export const REFUND_CUTOFF_HOURS = 24;
/** Hosts are paid this long after the start (after the refund window). */
export const PAYOUT_DELAY_HOURS = 24;
/** How long a spot is held while someone pays. */
export const RESERVE_MINUTES = 15;

export const APP_URL = (Deno.env.get("APP_URL") ?? "https://ddeonmadeit.github.io/happs/").replace(/\/?$/, "/");
export const STRIPE_COUNTRY = Deno.env.get("STRIPE_COUNTRY") ?? "AU";

export function platformFee(amountCents: number) {
  return Math.round(amountCents * PLATFORM_FEE_RATE);
}

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new HttpError(503, "Ticketing isn't set up yet");
  stripeClient ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  return stripeClient;
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The signed-in user making the request. */
export async function requireUser(req: Request, db: SupabaseClient): Promise<User> {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Please sign in");
  const { data, error } = await db.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, "Please sign in");
  return data.user;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid request");
  }
}

/** Turns thrown errors into JSON responses (Stripe errors included). */
export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message, ...err.extra }, err.status);
  if (err instanceof Stripe.errors.StripeError) {
    console.error("Stripe error:", err.type, err.code, err.message);
    return json({ error: err.message }, err.statusCode && err.statusCode < 500 ? 400 : 502);
  }
  console.error(err);
  return json({ error: "Something went wrong" }, 500);
}

/** Refund a paid ticket in full, taking the host's share back first if it was already paid out. */
export async function refundTicket(
  db: SupabaseClient,
  ticket: { id: string; stripe_payment_intent_id: string | null; stripe_transfer_id: string | null },
  reason: string,
) {
  if (!ticket.stripe_payment_intent_id) throw new HttpError(400, "This ticket wasn't paid for");
  const s = stripe();
  if (ticket.stripe_transfer_id) {
    await s.transfers.createReversal(ticket.stripe_transfer_id, {}, { idempotencyKey: `reverse-${ticket.id}` });
  }
  await s.refunds.create(
    { payment_intent: ticket.stripe_payment_intent_id, metadata: { ticket_id: ticket.id, reason } },
    { idempotencyKey: `refund-${ticket.id}` },
  );
  const { error } = await db
    .from("tickets")
    .update({ status: "refunded", refunded_at: new Date().toISOString() })
    .eq("id", ticket.id);
  if (error) throw error;
}

export { Stripe };
