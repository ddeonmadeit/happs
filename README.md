# The Happs

See what's happening around you, right now. Happs are live events pinned on a
map of Sydney. Anyone nearby can join one, post photos and short videos to its
story, and vote it a **Dead Happ (DH)** once it's winding down. The app also has
profiles, follows, likes, comments, direct messages and push notifications.

This repo is a full rebuild of the original Lovable app
(`thehapps.lovable.app`): the same features, screens and data model, with a
new Supabase backend, a long list of bug fixes, and a simpler, cleaner UI.

**Stack:** React 18 · TypeScript · Vite · Tailwind CSS · Supabase (Postgres,
Auth, Storage, Realtime, Edge Functions) · Mapbox GL · installable PWA with web
push.

---

## Quick start

```bash
npm install
cp .env.example .env        # fill in your Supabase URL + publishable key
npm run dev                 # http://localhost:8080
```

Without a `.env`, the app shows a setup screen instead of crashing.

| Script              | What it does                          |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Dev server                            |
| `npm run build`     | Type-check, then build to `dist/`     |
| `npm run preview`   | Serve the production build            |
| `npm run typecheck` | Type-check only                       |

## Backend setup (Supabase)

Everything the backend needs lives in `supabase/`.

1. **Create a project** at [supabase.com](https://supabase.com) and link it:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   ```
2. **Create the database** (tables, RLS, triggers, RPCs, the `media` storage
   bucket and realtime):
   ```bash
   npx supabase db push
   ```
3. **Set function secrets:**
   ```bash
   # Public Mapbox token (pk.*) from https://account.mapbox.com
   npx supabase secrets set MAPBOX_PUBLIC_TOKEN=pk.xxxx

   # Web push keys. Generate a pair once:
   npx web-push generate-vapid-keys
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
   # Optional:
   npx supabase secrets set VAPID_SUBJECT=mailto:you@example.com NEARBY_RADIUS_METERS=5000
   ```
4. **Deploy the edge functions:**
   ```bash
   npx supabase functions deploy get-mapbox-token
   npx supabase functions deploy get-vapid-key
   npx supabase functions deploy send-push
   ```
5. **Auth settings** (Dashboard → Authentication → URL Configuration): set
   the **Site URL** to your app's URL and add `https://<your-domain>/auth` (and
   `http://localhost:8080/auth` for dev) to **Redirect URLs**. This is needed
   for email confirmation and password-reset links. Email confirmation can stay
   on; the app now handles the "check your email" step.
6. Put the project URL and publishable (anon) key in `.env`.

### Data model

| Table                | Purpose                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `profiles`           | One per user, created automatically on sign-up (username, name, bio, avatar) |
| `happs`              | Events on the map (location, suburb, cover image, live/dead, activity) |
| `happ_participants`  | Who joined each happ, plus their Dead Happ vote                      |
| `posts`              | Photo/video story posts inside a happ                                |
| `post_likes`, `comments` | Reactions on posts                                               |
| `follows`            | Follower graph                                                       |
| `conversations`, `messages` | Direct messages (one conversation per pair of users)          |
| `push_subscriptions` | Web push endpoints (+ rough location for "nearby" alerts)            |
| `notification_log`   | Makes sure each message/happ is only notified once (service role only) |

Rules the database enforces (instead of trusting the browser):

- A happ shows on the map for 24 h after it's created, as long as there's been
  activity in the last 2 h (`get_map_happs`).
- Posting joins you to the happ, bumps its activity and clears your own DH vote.
- A happ turns **dead** (red) once more than half its participants have voted DH
  (`toggle_dead_happ`). Only participants can vote.
- Participant counts, `last_message_at` and read receipts are kept in sync by
  triggers and RPCs.
- Every table has row-level security. Users can only write their own rows and
  only upload into their own folder in the `media` bucket.

### Edge functions

| Function           | Purpose                                                        |
| ------------------ | -------------------------------------------------------------- |
| `get-mapbox-token` | Returns the public Mapbox token (skipped if `VITE_MAPBOX_TOKEN` is set) |
| `get-vapid-key`    | Returns the VAPID public key for push subscriptions            |
| `send-push`        | Notifies the recipient of a new message, and nearby subscribers of a new happ |

### Moving data over from the old app

The tables and columns keep the original names, so you can export each table
from the old project (CSV or `pg_dump --data-only`) and import it into the new
one, in this order: `profiles` → `happs` → `happ_participants` → `posts` →
`post_likes`, `comments`, `follows` → `conversations` → `messages`. Users need
to exist in `auth.users` first. The easiest route is a full `pg_dump` of both
the `auth` and `public` schemas. The new schema is stricter, so fix these before
importing:

- Usernames must be 3–20 lowercase letters, numbers or underscores.
- There can be only one conversation per pair of users.
- Every `user_id` must belong to an existing profile.

Uploaded media URLs still point at the old storage bucket. Copy the files over
if you're retiring that project.

## Deploying the frontend

It's a static single-page app. Build with `npm run build` and host `dist/`
anywhere with an SPA fallback. `vercel.json` (Vercel) and `public/_redirects`
(Netlify, Cloudflare Pages) are included. Set the same `VITE_*` variables in
your host's environment settings.

The map is limited to Greater Sydney, as in the original. Change `MAP_BOUNDS`
and `MAP_CENTER` in `src/lib/constants.ts` to open it up.

---

## What changed from the original

### Bugs fixed

**Posting and camera**
- Captured photos and videos were stored as base64 in `sessionStorage`. Anything
  over about 5 MB (most videos) hit the storage quota and the preview never
  opened. Media now stays in memory as a `Blob`.
- A stale "post to this happ" id from an abandoned flow could hijack a later
  "create a happ", so your new happ's first post went to the old happ. The flow
  now has one explicit target.
- The 15-second video limit never triggered (the timer read stale state), and
  the camera light could stay on after leaving. Both now use refs.
- Videos were always labelled WebM, which iPhones can't record or play. The
  recorder now picks a supported format (MP4 where available).
- Tapping the camera button away from any happ opened the camera anyway, then
  failed with "No happ to post to". You now get a prompt to create one instead.
- The camera had no fallback. You can now pick a photo or video from your
  library.

**Accounts and profiles**
- Sign-up skipped the "add a photo" step: saving a username redirected straight
  to the map.
- With email confirmation on, sign-up carried on without a session and then
  failed to save the username. It now shows a "check your email" step.
- There was no way to reset a forgotten password. Added.
- Editing your profile let you blank or duplicate your username, which locked
  you out behind onboarding. Now validated.
- New avatars overwrote the same file name, so browsers kept showing the old
  picture. Uploads now get unique names and are resized first.
- The profile "Happs" tab just showed the posts grid again. It now lists the
  happs you've created or joined.
- Tapping a post in a profile grid opened that person's story at the newest
  post, not the one you tapped.

**Map and happs**
- The map made one request per happ on every load, and redid all of them on any
  change anywhere. It's now one query.
- Changing the theme destroyed and rebuilt the whole map. The basemap now swaps
  in place.
- Your Dead Happ vote (the red ring on your avatar) reset on every reload.
- Dead Happ votes and happ status were written directly from the browser. They
  now go through a server-side function.
- Participant counts were set to 1 on creation and never updated.
- Location was read once, so "nearby" went stale as you walked around. It's now
  watched continuously.
- The Create Happ location always said "NSW", whatever the real state was.

**Messages**
- The chat never scrolled to new messages.
- An open conversation was lost on refresh or back navigation. Conversations
  now have their own URL (`/messages/:id`).
- The inbox made three queries per conversation. It's now one.
- Duplicate conversations between the same two people were possible.
- Sent messages only appeared once realtime echoed them back. They're now shown
  instantly, with retry if sending fails. Read receipts ("Seen") were added too.

**Notifications and PWA**
- Push notifications could be turned on but never arrived: nothing sent them,
  and the service worker had no push handler. Both are implemented now (new
  messages, and new happs nearby).
- The notifications toggle could spin forever when no service worker was
  registered.
- The service worker cached *all* Supabase API responses, which could show stale
  data, or another account's data after switching users. It now caches only
  uploaded images.
- A 1.5 MB font was preloaded on every visit but never used. Removed.
- The "512px PNG" app icon was actually a 784px JPEG. Proper 192/512 PNG icons
  now.

**UI**
- Create Happ inputs were white-on-white in dark mode.
- The notch area was padded twice (on `<body>` and on every page).
- Searching for text with a comma or bracket broke the search query.
- There were two separate toast systems. Now there's one.

### Visual cleanup

- One consistent design language: rounded surfaces, a single accent colour per
  theme, and consistent 44 px touch targets and spacing on every screen.
- The heavy embossed drop-shadows are gone. The Brunson display font is kept for
  the wordmark and "DH" moments.
- Map controls sit in a single floating dock (Post · Create · DH), with a
  "You're at …" chip when you're inside a happ and a recentre button.
- Stories are a proper full-screen viewer: tap left or right to move, progress
  bars, and comments in a sheet.
- Bottom sheets and dialogs animate smoothly, the inbox and map show
  placeholders while loading, and animations respect "reduce motion".
- All three colour schemes (Earth, Warm, Jaded) in light and dark still work.
  The saved theme is applied before first paint, so there's no flash of the
  wrong colours.
- Code-split routes. The first screen loads about 4× less JavaScript than
  before, and the map loads only when you open it.

## Project structure

```
src/
  pages/            one file per screen (Map, CreateHapp, HappDetail, Story, Profile, Camera, Chat…)
  components/       shared UI (TopBar, MapHeader, HappMap, sheets) and ui/ primitives
  contexts/         Auth, Theme, Push providers
  hooks/            geolocation, realtime, unread count, install prompt
  lib/              draft store, media upload, Mapbox helpers, constants
  integrations/supabase/   typed client + database types
  sw.ts             service worker (precache + push)
supabase/
  migrations/       full database schema
  functions/        edge functions
```
