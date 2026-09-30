#!/usr/bin/env node
/**
 * One-command backend setup for The Happs.
 *
 * Creates (or reuses) the Supabase project, builds the database, deploys the
 * edge functions and their secrets, turns on sign-up redirects, and wires up
 * Stripe: webhooks, the hourly payout job and the Apple Pay domain.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... STRIPE_SECRET_KEY=sk_test_... \
 *   STRIPE_PUBLISHABLE_KEY=pk_test_... node scripts/provision.mjs [--switch-live]
 *
 * Environment:
 *   SUPABASE_ACCESS_TOKEN   required. supabase.com/dashboard/account/tokens
 *   STRIPE_SECRET_KEY       for paid happs (sk_test_… or sk_live_…)
 *   STRIPE_PUBLISHABLE_KEY  for paid happs (pk_test_… or pk_live_…)
 *   SUPABASE_PROJECT_REF    use this existing project instead of finding/creating "the-happs"
 *   SUPABASE_ORG_ID         which organization to create the project in (default: the first)
 *   SUPABASE_REGION         default ap-southeast-2 (Sydney)
 *   APP_URL                 default https://ddeonmadeit.github.io/happs/
 *   MAPBOX_PUBLIC_TOKEN     default: the token the original backend serves
 *
 * --switch-live  also points the GitHub Pages build at this backend (edits
 *                .github/workflows/deploy.yml; commit and push to go live).
 *
 * Safe to re-run: every step checks what's already there first.
 */
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_NAME = "the-happs";
const SUPABASE_API = process.env.SUPABASE_API_URL ?? "https://api.supabase.com/v1";
const STRIPE_API = process.env.STRIPE_API_URL ?? "https://api.stripe.com/v1";
/** Matches the stripe npm version the edge functions use. */
const STRIPE_API_VERSION = "2025-02-24.acacia";
const SUPABASE_CLI = (process.env.SUPABASE_CLI ?? "npx -y supabase@2").split(" ");
const APP_URL = (process.env.APP_URL ?? "https://ddeonmadeit.github.io/happs/").replace(/\/?$/, "/");
const REGION = process.env.SUPABASE_REGION ?? "ap-southeast-2";
const SWITCH_LIVE = process.argv.includes("--switch-live");

// The original backend (public values, already in deploy.yml). Only used to
// borrow its public Mapbox token when none is given.
const LEGACY_URL = "https://eqvucbryrllabqcvqbdo.supabase.co";
const LEGACY_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxdnVjYnJ5cmxsYWJxY3ZxYmRvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NzM0ODgsImV4cCI6MjA4MzQ0OTQ4OH0.XWa9bNWIKfpogrMU9qr-REteAGGWSfTXe7G-wcdZsKQ";

const token = process.env.SUPABASE_ACCESS_TOKEN;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const stripePublishable = process.env.STRIPE_PUBLISHABLE_KEY;

const step = (msg) => console.log(`\n▸ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => console.log(`  • ${msg}`);
const todo = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const secret = (bytes = 24) => randomBytes(bytes).toString("base64url");

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// APIs
// ---------------------------------------------------------------------------
async function supabase(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SUPABASE_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (res.ok) return data;
    // Rate limits and a project that's still waking up are worth waiting out.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    const err = new Error(`Supabase ${method} ${path} → ${res.status}: ${data?.message ?? text}`);
    err.status = res.status;
    throw err;
  }
}

async function stripe(method, path, params) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
    },
    body: params ? form(params) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(`Stripe ${method} ${path} → ${res.status}: ${data?.error?.message}`);
    err.status = res.status;
    err.stripe = data?.error;
    throw err;
  }
  return data;
}

/** Stripe's form encoding: nested objects as a[b]=c, arrays as a[]=x. */
function form(params, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item) => out.append(`${key}[]`, String(item)));
    else if (v && typeof v === "object") form(v, key, out);
    else if (v !== undefined) out.append(key, String(v));
  }
  return out;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

const sql = (ref, query) => supabase("POST", `/projects/${ref}/database/query`, { query });
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
async function findOrCreateProject() {
  step("Supabase project");
  const projects = await supabase("GET", "/projects");
  const wanted = process.env.SUPABASE_PROJECT_REF;
  let project = wanted ? projects.find((p) => p.id === wanted || p.ref === wanted) : projects.find((p) => p.name === PROJECT_NAME);
  if (wanted && !project) fail(`No project with ref ${wanted} on this account.`);
  if (project) {
    ok(`Using ${project.name} (${project.id}, ${project.region})`);
    return project.id;
  }

  const orgs = await supabase("GET", "/organizations");
  const org = process.env.SUPABASE_ORG_ID ? orgs.find((o) => o.id === process.env.SUPABASE_ORG_ID) : orgs[0];
  if (!org) fail("No Supabase organization found. Create one at supabase.com/dashboard first.");

  const base = { name: PROJECT_NAME, db_pass: secret(24), region: REGION };
  try {
    project = await supabase("POST", "/projects", { ...base, organization_id: org.id });
  } catch (err) {
    if (err.status !== 400 && err.status !== 422) throw err;
    project = await supabase("POST", "/projects", { ...base, organization_slug: org.id });
  }
  ok(`Created ${PROJECT_NAME} (${project.id}) in ${org.name}, region ${REGION}`);
  note("The database password was random and isn't needed again. Reset it in the dashboard if you ever want it.");
  return project.id;
}

async function waitUntilReady(ref) {
  step("Waiting for the project to be ready");
  const until = Date.now() + 15 * 60_000;
  let last = "";
  while (Date.now() < until) {
    const p = await supabase("GET", `/projects/${ref}`).catch(() => null);
    if (p?.status !== last && p?.status) note((last = p.status));
    if (p?.status === "ACTIVE_HEALTHY") {
      try {
        await sql(ref, "select 1");
        ok("Database is up");
        return;
      } catch {
        // Healthy but not taking queries yet.
      }
    }
    await sleep(10_000);
  }
  fail("The project didn't become ready within 15 minutes. Re-run this script to carry on.");
}

async function migrate(ref) {
  step("Database");
  await sql(
    ref,
    `create schema if not exists supabase_migrations;
     create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`,
  );
  const rows = await sql(ref, "select version from supabase_migrations.schema_migrations");
  const applied = new Set((rows ?? []).map((r) => r.version));
  const files = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    const name = rest.join("_");
    if (applied.has(version)) {
      ok(`${file} (already applied)`);
      continue;
    }
    const body = readFileSync(join(ROOT, "supabase/migrations", file), "utf8");
    await sql(
      ref,
      `begin;\n${body}\n;\ninsert into supabase_migrations.schema_migrations (version, name, statements) values (${lit(version)}, ${lit(name)}, array[]::text[]);\ncommit;`,
    );
    ok(file);
  }
}

async function configureAuth(ref) {
  step("Sign-in settings");
  await supabase("PATCH", `/projects/${ref}/config/auth`, {
    site_url: APP_URL,
    uri_allow_list: [`${APP_URL}**`, "http://localhost:8080/**"].join(","),
    // Supabase's built-in mailer only emails the project's own team, so
    // confirmation emails would never reach real users. Accounts work
    // straight away instead; add SMTP (Auth → SMTP) to turn confirmation back on.
    mailer_autoconfirm: true,
  });
  ok(`Site URL ${APP_URL}, redirects allowed, email confirmation off until SMTP is set up`);
  todo.push("Password-reset emails only reach your own Supabase team until you add SMTP (Dashboard → Authentication → SMTP, e.g. Resend's free plan).");
}

async function apiKeys(ref) {
  const keys = await supabase("GET", `/projects/${ref}/api-keys?reveal=true`);
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const publishable = keys.find((k) => k.type === "publishable")?.api_key;
  const key = anon ?? publishable;
  if (!key) fail("Couldn't read the project's API keys.");
  return key;
}

/** Secrets already on the project, by name -> digest. */
async function existingSecrets(ref) {
  const list = (await supabase("GET", `/projects/${ref}/secrets`)) ?? [];
  return new Map(list.map((s) => [s.name, s.value]));
}

const sameSecret = (digest, value) => digest === value || digest === sha256(value);

/** P-256 key pair for web push, as base64url strings. */
function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  return { VAPID_PUBLIC_KEY: point.toString("base64url"), VAPID_PRIVATE_KEY: priv.d };
}

async function mapboxToken() {
  if (process.env.MAPBOX_PUBLIC_TOKEN) return process.env.MAPBOX_PUBLIC_TOKEN;
  const res = await fetch(`${LEGACY_URL}/functions/v1/get-mapbox-token`, {
    method: "POST",
    headers: { apikey: LEGACY_ANON_KEY, Authorization: `Bearer ${LEGACY_ANON_KEY}`, "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => null);
  const data = res?.ok ? await res.json().catch(() => null) : null;
  return data?.token ?? null;
}

async function setSecrets(ref, current) {
  step("Function secrets");
  const next = { APP_URL, STRIPE_COUNTRY: "AU", VAPID_SUBJECT: APP_URL };
  if (!current.has("VAPID_PUBLIC_KEY")) Object.assign(next, vapidKeys());
  if (!current.has("MAPBOX_PUBLIC_TOKEN")) {
    const mapbox = await mapboxToken();
    if (mapbox) next.MAPBOX_PUBLIC_TOKEN = mapbox;
    else todo.push("Set MAPBOX_PUBLIC_TOKEN (a public pk.* token from account.mapbox.com) so the map loads.");
  }
  if (stripeKey) next.STRIPE_SECRET_KEY = stripeKey;

  const changes = Object.entries(next).filter(([name, value]) => !current.has(name) || !sameSecret(current.get(name), value));
  if (changes.length) {
    await supabase("POST", `/projects/${ref}/secrets`, changes.map(([name, value]) => ({ name, value })));
  }
  ok(changes.length ? `Set ${changes.map(([n]) => n).join(", ")}` : "Already up to date");
}

async function deployFunctions(ref) {
  step("Edge functions");
  const [cmd, ...args] = SUPABASE_CLI;
  // Supabase's bundler sometimes has a bad moment (HTTP 500); try again.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = spawnSync(cmd, [...args, "functions", "deploy", "--project-ref", ref, "--use-api"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
    });
    if (res.status === 0) return;
    if (attempt < 3) {
      note(`Deploy failed, trying again (${attempt + 1}/3)…`);
      await sleep(15_000);
    }
  }
  fail("Deploying the edge functions failed (see above). Re-run to retry.");
}

async function checkFunctions(ref) {
  const deployed = new Set(((await supabase("GET", `/projects/${ref}/functions`)) ?? []).map((f) => f.slug));
  const local = readdirSync(join(ROOT, "supabase/functions"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);
  const missing = local.filter((f) => !deployed.has(f));
  if (missing.length) fail(`Not deployed: ${missing.join(", ")}`);
  ok(`${local.length} functions live`);
}

async function setUpStripe(ref, current) {
  step("Stripe");
  const mode = stripeKey.startsWith("sk_live_") ? "live" : "test";
  const account = await stripe("GET", "/account");
  ok(`${account.settings?.dashboard?.display_name || account.business_profile?.name || account.id} (${mode} mode)`);
  if (stripePublishable && !stripePublishable.startsWith(`pk_${mode}_`)) {
    fail(`STRIPE_PUBLISHABLE_KEY is not a ${mode}-mode key but STRIPE_SECRET_KEY is.`);
  }

  // Connect has to be switched on once, in the dashboard.
  const connectOn = await connectEnabled(mode);
  if (connectOn === false) {
    todo.push(
      "Turn on Stripe Connect: dashboard.stripe.com/connect → Get started → Platform/marketplace, Express accounts. Hosts can't set up payouts until then; buying tickets already works.",
    );
    note("Connect isn't on yet (hosts can't set up payouts until it is)");
  } else if (connectOn) ok("Connect is on");
  else {
    note("Can't check Connect in live mode without creating an account");
    todo.push(
      "Make sure Stripe Connect is on (dashboard.stripe.com/connect → finish the platform questionnaire, Express accounts). Hosts need it to set up payouts.",
    );
  }

  // Webhooks: one for payments on our account, one for host accounts.
  const url = `https://${ref}.supabase.co/functions/v1/stripe-webhook`;
  const endpoints = (await stripe("GET", "/webhook_endpoints?limit=100")).data.filter(
    (e) => e.metadata?.app === "the-happs" && e.url === url && e.status === "enabled",
  );
  const haveBoth = ["account", "connect"].every((kind) => endpoints.some((e) => e.metadata.kind === kind));
  const keyUnchanged = current.has("STRIPE_SECRET_KEY") && sameSecret(current.get("STRIPE_SECRET_KEY"), stripeKey);
  if (haveBoth && current.has("STRIPE_WEBHOOK_SECRET") && keyUnchanged) {
    ok("Webhooks already set up");
  } else {
    for (const e of endpoints) await stripe("DELETE", `/webhook_endpoints/${e.id}`);
    const common = { url, api_version: STRIPE_API_VERSION };
    const own = await stripe("POST", "/webhook_endpoints", {
      ...common,
      description: "The Happs: ticket payments and refunds",
      enabled_events: ["payment_intent.succeeded", "payment_intent.canceled", "charge.refunded"],
      metadata: { app: "the-happs", kind: "account" },
    });
    const connect = await stripe("POST", "/webhook_endpoints", {
      ...common,
      connect: true,
      description: "The Happs: host payout accounts",
      enabled_events: ["account.updated"],
      metadata: { app: "the-happs", kind: "connect" },
    });
    await supabase("POST", `/projects/${ref}/secrets`, [
      { name: "STRIPE_WEBHOOK_SECRET", value: `${own.secret},${connect.secret}` },
    ]);
    ok("Webhooks created and their signing secrets saved");
  }

  // Apple Pay (and Google Pay / Link) on the app's domain.
  const domain = new URL(APP_URL).hostname;
  let pmd = (await stripe("GET", `/payment_method_domains?domain_name=${encodeURIComponent(domain)}`)).data[0];
  pmd ??= await stripe("POST", "/payment_method_domains", { domain_name: domain });
  if (pmd.apple_pay?.status === "active") ok(`Apple Pay on ${domain}`);
  else {
    note(`Apple Pay on ${domain}: ${pmd.apple_pay?.status_details?.error_message ?? pmd.apple_pay?.status ?? "pending"}`);
    todo.push(`Apple Pay isn't active on ${domain} yet (cards and Google Pay work). See Stripe → Settings → Payment method domains.`);
  }
  if (mode === "live" && !account.charges_enabled) {
    todo.push("Finish activating your Stripe account (business details and bank) so it can take live payments.");
  }
}

/** true / false, or null when it can't be told without side effects. */
async function connectEnabled(mode) {
  if (mode !== "test") {
    return stripe("GET", "/accounts?limit=1").then(
      () => null,
      () => false,
    );
  }
  // In test mode, try making (and removing) a throwaway host account.
  try {
    const acct = await stripe("POST", "/accounts", {
      type: "express",
      country: "AU",
      capabilities: { transfers: { requested: true } },
      metadata: { purpose: "the-happs setup check" },
    });
    await stripe("DELETE", `/accounts/${acct.id}`).catch(() => undefined);
    return true;
  } catch (err) {
    if (/connect/i.test(err.stripe?.message ?? "")) return false;
    throw err;
  }
}

async function schedulePayouts(ref, current) {
  step("Hourly payouts");
  // A fresh secret each run keeps the job and the function in step even
  // without remembering the old one.
  const cronSecret = secret(24);
  await supabase("POST", `/projects/${ref}/secrets`, [{ name: "CRON_SECRET", value: cronSecret }]);
  const url = `https://${ref}.supabase.co/functions/v1/release-payouts`;
  await sql(
    ref,
    `create extension if not exists pg_cron with schema pg_catalog;
     grant usage on schema cron to postgres;
     create extension if not exists pg_net with schema extensions;
     select cron.unschedule(jobid) from cron.job where jobname = 'release-payouts';
     select cron.schedule('release-payouts', '7 * * * *', $job$
       select net.http_post(
         url := ${lit(url)},
         headers := jsonb_build_object('x-cron-secret', ${lit(cronSecret)}, 'content-type', 'application/json'),
         body := '{}'::jsonb
       );
     $job$);`,
  );
  ok(`release-payouts runs at 7 past every hour${current.has("CRON_SECRET") ? " (secret rotated)" : ""}`);
  return cronSecret;
}

async function smokeTest(ref, anonKey, cronSecret) {
  step("Checking it all works");
  const base = `https://${ref}.supabase.co`;
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" };
  const check = async (label, fn) => {
    try {
      const detail = await fn();
      ok(`${label}${detail ? `: ${detail}` : ""}`);
    } catch (err) {
      note(`${label}: ${err.message}`);
      todo.push(`Check failed: ${label} (${err.message})`);
    }
  };
  const expect = async (res, status) => {
    if (res.status !== status) throw new Error(`HTTP ${res.status} ${await res.text().catch(() => "")}`.slice(0, 200));
    return res;
  };

  await check("Map query", async () => {
    const res = await expect(await fetch(`${base}/rest/v1/rpc/get_map_happs`, { method: "POST", headers, body: "{}" }), 200);
    return `${(await res.json()).length} happs`;
  });
  await check("Push key", async () => {
    const res = await expect(await fetch(`${base}/functions/v1/get-vapid-key`, { method: "POST", headers, body: "{}" }), 200);
    return (await res.json()).publicKey ? "" : "missing";
  });
  await check("Map token", async () => {
    const res = await expect(await fetch(`${base}/functions/v1/get-mapbox-token`, { method: "POST", headers, body: "{}" }), 200);
    if (!(await res.json()).token) throw new Error("no token");
  });
  if (stripeKey) {
    // 400 means the webhook is configured and checks Stripe's signature.
    await check("Stripe webhook", async () => {
      await expect(await fetch(`${base}/functions/v1/stripe-webhook`, { method: "POST", body: "{}" }), 400);
    });
    await check("Payout job", async () => {
      // New secrets reach running functions within a few seconds.
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${base}/functions/v1/release-payouts`, {
          method: "POST",
          headers: { "x-cron-secret": cronSecret, "Content-Type": "application/json" },
          body: "{}",
        });
        if (res.status === 200 || attempt >= 5) return void (await expect(res, 200));
        await sleep(5000);
      }
    });
  }
}

function switchLive(url, anonKey) {
  step("Pointing the live site at this backend");
  const file = join(ROOT, ".github/workflows/deploy.yml");
  let yml = readFileSync(file, "utf8");
  const setDefault = (name, value) => {
    const re = new RegExp(`(${name}: \\$\\{\\{ vars\\.${name})(?: \\|\\| '[^']*')?( \\}\\})`);
    if (!re.test(yml)) fail(`Couldn't find ${name} in deploy.yml`);
    yml = yml.replace(re, `$1 || '${value}'$2`);
  };
  setDefault("VITE_SUPABASE_URL", url);
  setDefault("VITE_SUPABASE_PUBLISHABLE_KEY", anonKey);
  if (stripePublishable) setDefault("VITE_STRIPE_PUBLISHABLE_KEY", stripePublishable);
  yml = yml.replace(
    /# Backend\. Defaults to the original The Happs project;/,
    "# Backend. Defaults to The Happs' own Supabase project;",
  );
  writeFileSync(file, yml);
  ok("Updated .github/workflows/deploy.yml. Commit and push to deploy.");
}

// ---------------------------------------------------------------------------
if (!token) fail("Set SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens).");
if (Boolean(stripeKey) !== Boolean(stripePublishable)) {
  note("Paid happs need both STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY.");
}

const ref = await findOrCreateProject();
await waitUntilReady(ref);
await migrate(ref);
await configureAuth(ref);
const current = await existingSecrets(ref);
await setSecrets(ref, current);
await deployFunctions(ref);
await checkFunctions(ref);
let cronSecret = null;
if (stripeKey) {
  await setUpStripe(ref, current);
  cronSecret = await schedulePayouts(ref, current);
} else {
  todo.push("Paid happs are off: re-run with STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY to switch them on.");
}
const url = `https://${ref}.supabase.co`;
const anonKey = await apiKeys(ref);
await smokeTest(ref, anonKey, cronSecret);
if (SWITCH_LIVE) switchLive(url, anonKey);

console.log(`\nDone.\n  VITE_SUPABASE_URL=${url}\n  VITE_SUPABASE_PUBLISHABLE_KEY=${anonKey}`);
if (stripePublishable) console.log(`  VITE_STRIPE_PUBLISHABLE_KEY=${stripePublishable}`);
if (!SWITCH_LIVE && !readFileSync(join(ROOT, ".github/workflows/deploy.yml"), "utf8").includes(ref)) {
  console.log("\nThe live site uses a different backend. Re-run with --switch-live to move it here.");
}
if (todo.length) console.log(`\nStill to do:\n${todo.map((t) => `  - ${t}`).join("\n")}`);
