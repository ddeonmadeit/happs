/**
 * Ticketing: paid happs, buying tickets, check-in and host payouts.
 *
 * Money only ever moves in the edge functions (supabase/functions/stripe-*,
 * ticket-*, cancel-happ, release-payouts). It needs this repo's own backend
 * and a Stripe publishable key; on the original backend the feature is
 * simply hidden.
 */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { HappRow, TicketRow } from "@/integrations/supabase/types";
import { backendMode } from "@/lib/api";

export const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
/** The Happs' share of each ticket. */
export const PLATFORM_FEE_RATE = 0.13;
export const REFUND_CUTOFF_HOURS = 24;
export const MIN_PRICE_CENTS = 200;
export const MAX_PRICE_CENTS = 100_000;

let enabled: Promise<boolean> | null = null;
/** Paid happs work only on this repo's backend with Stripe configured. */
export function ticketingEnabled() {
  enabled ??= STRIPE_PUBLISHABLE_KEY
    ? backendMode().then((mode) => mode === "modern")
    : Promise.resolve(false);
  return enabled;
}

export function formatPrice(cents: number, currency = "aud") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

/** What the host gets for one ticket. */
export function hostShare(cents: number) {
  return cents - Math.round(cents * PLATFORM_FEE_RATE);
}

/** "476E3FD08FDF" -> "476E-3FD0-8FDF" */
export function formatCode(code: string) {
  return code.match(/.{1,4}/g)?.join("-") ?? code;
}

/** What the door QR code encodes. */
export const qrPayload = (code: string) => `HAPPS-${code}`;

/** Can the buyer still refund themselves? */
export function refundOpen(startsAt: string, now = Date.now()) {
  return Date.parse(startsAt) - now > REFUND_CUTOFF_HOURS * 3600_000;
}

/** Call an edge function; errors carry the function's own message. */
async function call<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    let message = "Something went wrong";
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      if (payload?.error) message = payload.error;
    }
    throw Object.assign(new Error(message), { cause: error });
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------
export type Checkout = { client_secret: string; ticket_id: string; amount_cents: number; currency: string };

export const startCheckout = (happId: string) => call<Checkout>("ticket-checkout", { happ_id: happId });

export const requestRefund = (ticketId: string) => call<{ refunded: boolean }>("ticket-refund", { ticket_id: ticketId });

export type TicketWithHapp = TicketRow & {
  happs: Pick<HappRow, "id" | "name" | "starts_at" | "created_at" | "suburb" | "icon_url" | "latitude" | "longitude" | "cancelled_at"> | null;
};

const TICKET_COLUMNS =
  "*, happs(id, name, starts_at, created_at, suburb, icon_url, latitude, longitude, cancelled_at)";

/** Your paid (or refunded) tickets, soonest happ first. */
export async function fetchMyTickets(userId: string): Promise<TicketWithHapp[]> {
  const { data } = await supabase
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("user_id", userId)
    .in("status", ["valid", "refunded"])
    .order("created_at", { ascending: false });
  return (data ?? []) as unknown as TicketWithHapp[];
}

export async function fetchTicket(ticketId: string): Promise<TicketWithHapp | null> {
  const { data } = await supabase.from("tickets").select(TICKET_COLUMNS).eq("id", ticketId).maybeSingle();
  return (data as unknown as TicketWithHapp) ?? null;
}

/** Your valid ticket for a happ, if you have one. */
export async function fetchMyTicketFor(happId: string, userId: string) {
  const { data } = await supabase
    .from("tickets")
    .select("id, status")
    .eq("happ_id", happId)
    .eq("user_id", userId)
    .eq("status", "valid")
    .maybeSingle();
  return data;
}

/** Wait (briefly) for Stripe's confirmation to turn a ticket valid. */
export async function waitForTicket(ticketId: string, timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const { data } = await supabase.from("tickets").select("status").eq("id", ticketId).maybeSingle();
    if (data?.status === "valid") return true;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

export async function ticketsLeft(happ: Pick<HappRow, "id" | "capacity">) {
  if (!happ.capacity) return null;
  const { data } = await supabase.rpc("tickets_taken", { p_happ_id: happ.id });
  return Math.max(0, happ.capacity - (typeof data === "number" ? data : 0));
}

// ---------------------------------------------------------------------------
// Hosting
// ---------------------------------------------------------------------------
export type Sales = { sold: number; checkedIn: number; earningsCents: number; currency: string };

export async function fetchSales(happId: string): Promise<Sales> {
  const { data } = await supabase
    .from("tickets")
    .select("amount_cents, platform_fee_cents, currency, checked_in_at")
    .eq("happ_id", happId)
    .eq("status", "valid");
  const rows = data ?? [];
  return {
    sold: rows.length,
    checkedIn: rows.filter((t) => t.checked_in_at).length,
    earningsCents: rows.reduce((sum, t) => sum + t.amount_cents - t.platform_fee_cents, 0),
    currency: rows[0]?.currency ?? "aud",
  };
}

export type Guest = Pick<TicketRow, "id" | "user_id" | "code" | "checked_in_at" | "status">;

export async function fetchGuests(happId: string): Promise<Guest[]> {
  const { data } = await supabase
    .from("tickets")
    .select("id, user_id, code, checked_in_at, status")
    .eq("happ_id", happId)
    .eq("status", "valid")
    .order("created_at");
  return data ?? [];
}

export type CheckIn =
  | { result: "admitted" | "already_checked_in"; ticket_id: string; user_id: string; checked_in_at: string }
  | { result: "not_valid"; status: string; user_id: string }
  | { result: "not_found" | "wrong_happ" };

export async function checkIn(code: string): Promise<CheckIn> {
  const { data, error } = await supabase.rpc("check_in_ticket", { p_code: code });
  if (error) throw error;
  return data as unknown as CheckIn;
}

/** Cancel a happ you're hosting; everyone with a ticket is refunded. */
export const cancelHapp = (happId: string) =>
  call<{ refunded: number; deleted: boolean }>("cancel-happ", { happ_id: happId });

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------
export type PayoutStatus = { connected: boolean; payouts_enabled: boolean; details_submitted: boolean; due: number };

export const payoutStatus = () => call<PayoutStatus>("stripe-connect", { action: "status" });

/** Stripe's secure setup page for getting paid (opens in place; comes back to /payouts). */
export async function startPayoutSetup() {
  const { url } = await call<{ url: string }>("stripe-connect", { action: "onboard" });
  window.location.assign(url);
}

export async function openPayoutDashboard() {
  const { url } = await call<{ url: string }>("stripe-connect", { action: "dashboard" });
  window.location.assign(url);
}

/** Whether payouts are fully set up (from the database; no Stripe call). */
export async function payoutsReady(userId: string) {
  const { data } = await supabase.from("stripe_accounts").select("payouts_enabled").eq("user_id", userId).maybeSingle();
  return Boolean(data?.payouts_enabled);
}
