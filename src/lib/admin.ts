/** The owner's dashboard (/dash). Every call is checked by the database (admin_* functions). */
import { supabase } from "@/integrations/supabase/client";
import type { AdminHappRow, AdminSaleRow, AdminUserRow } from "@/integrations/supabase/types";
import { backendMode } from "@/lib/api";

export type DailyPoint = { day: string; signups: number; happs: number; posts: number };

export type Overview = {
  users: number;
  users_today: number;
  users_7d: number;
  brands: number;
  active_7d: number;
  happs: number;
  happs_live: number;
  happs_upcoming: number;
  happs_7d: number;
  posts: number;
  posts_7d: number;
  messages_7d: number;
  follows: number;
  push_subscribers: number;
  paid_happs: number;
  tickets_sold: number;
  tickets_refunded: number;
  gross_cents: number;
  fees_cents: number;
  refunded_cents: number;
  owed_to_hosts_cents: number;
  paid_to_hosts_cents: number;
  hosts_with_payouts: number;
  daily: DailyPoint[];
  interests: Record<string, number>;
};

export async function isAdmin() {
  if ((await backendMode()) !== "modern") return false;
  const { data } = await supabase.rpc("is_admin");
  return data === true;
}

export async function claimAdmin(code: string) {
  const { data, error } = await supabase.rpc("claim_admin", { p_code: code.trim() });
  if (error) throw error;
  return data === true;
}

export async function fetchOverview(): Promise<Overview> {
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) throw error;
  return data as unknown as Overview;
}

export const USERS_PAGE = 50;

export async function fetchUsers(search: string, offset = 0): Promise<AdminUserRow[]> {
  const { data, error } = await supabase.rpc("admin_users", {
    p_search: search.trim() || null,
    p_limit: USERS_PAGE,
    p_offset: offset,
  });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminHapps(): Promise<AdminHappRow[]> {
  const { data, error } = await supabase.rpc("admin_happs", { p_limit: 30 });
  if (error) throw error;
  return data ?? [];
}

export async function fetchAdminSales(): Promise<AdminSaleRow[]> {
  const { data, error } = await supabase.rpc("admin_sales", { p_limit: 30 });
  if (error) throw error;
  return data ?? [];
}

/** 1,284 · 12.9K · 4.2M */
export function compact(n: number) {
  return new Intl.NumberFormat("en-AU", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
}
