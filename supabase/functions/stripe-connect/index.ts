// Payouts for hosts (Stripe Connect Express).
//
//   { action: "onboard" }   -> { url }  Stripe's secure setup page (created on first use)
//   { action: "status" }    -> { connected, payouts_enabled, details_submitted, due }
//   { action: "dashboard" } -> { url }  the host's Stripe Express dashboard
//
// Kept to one tap for hosts: the account is created for them with their
// email filled in, and Stripe only asks for what's needed right now.
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  admin,
  APP_URL,
  errorResponse,
  HttpError,
  readJson,
  requireUser,
  stripe,
  STRIPE_COUNTRY,
  type Stripe,
} from "../_shared/stripe.ts";

type Row = { stripe_account_id: string; payouts_enabled: boolean; details_submitted: boolean };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const db = admin();
    const user = await requireUser(req, db);
    const { action } = await readJson<{ action?: string }>(req);

    const { data: row } = await db
      .from("stripe_accounts")
      .select("stripe_account_id, payouts_enabled, details_submitted")
      .eq("user_id", user.id)
      .maybeSingle<Row>();

    if (action === "status") {
      if (!row) return json({ connected: false, payouts_enabled: false, details_submitted: false, due: 0 });
      const account = await stripe().accounts.retrieve(row.stripe_account_id);
      await save(db, user.id, account);
      return json(summary(account));
    }

    if (action === "onboard") {
      let accountId = row?.stripe_account_id;
      if (!accountId) {
        const account = await stripe().accounts.create(
          {
            type: "express",
            country: STRIPE_COUNTRY,
            email: user.email ?? undefined,
            business_type: "individual",
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            business_profile: {
              mcc: "7922", // theatrical producers & ticket agencies
              product_description: "Event tickets sold through The Happs",
              url: APP_URL,
            },
            metadata: { user_id: user.id },
          },
          { idempotencyKey: `connect-${user.id}` },
        );
        accountId = account.id;
        await save(db, user.id, account);
      }
      const link = await stripe().accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: `${APP_URL}payouts?refresh=1`,
        return_url: `${APP_URL}payouts?done=1`,
      });
      return json({ url: link.url });
    }

    if (action === "dashboard") {
      if (!row) throw new HttpError(404, "Set up payouts first");
      const link = await stripe().accounts.createLoginLink(row.stripe_account_id);
      return json({ url: link.url });
    }

    throw new HttpError(400, "Unknown action");
  } catch (err) {
    return errorResponse(err);
  }
});

function summary(account: Stripe.Account) {
  return {
    connected: true,
    details_submitted: account.details_submitted,
    payouts_enabled: account.payouts_enabled,
    due: account.requirements?.currently_due?.length ?? 0,
  };
}

async function save(db: ReturnType<typeof admin>, userId: string, account: Stripe.Account) {
  const { error } = await db.from("stripe_accounts").upsert({
    user_id: userId,
    stripe_account_id: account.id,
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    payouts_enabled: account.payouts_enabled,
  });
  if (error) throw error;
}
