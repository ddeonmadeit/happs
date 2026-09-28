# The Happs

See what's happening around you, right now. Happs are live events pinned on a
map of Sydney. Anyone nearby can join one, post photos and short videos to its
story, and vote it a **Dead Happ (DH)** once it's winding down. The app also has
profiles, follows, likes, comments, direct messages and push notifications.

**Live:** https://ddeonmadeit.github.io/happs/

This repo is a full rebuild of the original Lovable app: the same features and
data, with a simple charcoal-and-orange design, Waze-style springy
animations, and a proper full-screen home-screen app.

**Stack:** React 18 · TypeScript · Vite · Tailwind CSS · Motion (spring
animations) · Supabase · Mapbox GL · installable PWA · GitHub Pages.

---

## Use it like an app

Open the live link on your phone, then:

- **iPhone (Safari):** tap Share → **Add to Home Screen** → Add.
- **Android (Chrome):** menu ⋮ → **Install app**.

Launched from the home screen, it opens full-screen with a branded launch
screen: no browser bars, no page bounce, no pinch-zoom. The map stays loaded
in the background, so moving between screens is instant.

## Deployment (GitHub Pages)

Every push to the default branch builds and publishes the site
(`.github/workflows/deploy.yml`).

**One-time setup:** repo **Settings → Pages → Build and deployment → Source:
GitHub Actions**. Then re-run the "Deploy to GitHub Pages" workflow, or push
any commit.

The build uses `BASE_PATH=/<repo>/` so everything works under
`https://<user>.github.io/<repo>/`, and it writes a `404.html` copy of the app
so deep links and email links open correctly.

### Which backend the live site uses

By default the site talks to **the original The Happs Supabase project**, so
existing accounts and data keep working. That project has the same tables but
none of this repo's server-side functions. `src/lib/api.ts` detects this and
falls back to the queries the original app made. On that backend, push
notifications stay hidden because it never had a subscriptions table.

Two quirks of that backend are handled in the app:

- Its `posts.media_type` check rejects `"image"`, the label the old app sent,
  so every photo post in the old app silently failed. The app tries the usual
  labels in turn (`photo`, …) and remembers the one the database accepts.
- It has no `starts_at` column, so a scheduled happ is stored with
  `created_at` (and `last_activity_at`) set to its start time.

To move to your own project with the full backend below, add these under
**Settings → Secrets and variables → Actions → Variables** and re-run the
workflow:

| Variable                         | Value                               |
| -------------------------------- | ----------------------------------- |
| `VITE_SUPABASE_URL`              | `https://<ref>.supabase.co`         |
| `VITE_SUPABASE_PUBLISHABLE_KEY`  | your project's publishable/anon key |
| `VITE_MAPBOX_TOKEN` *(optional)* | a public Mapbox token               |

The app switches to the new functions automatically. Add
`https://<user>.github.io/<repo>/auth` to the project's Auth redirect URLs.

## Local development

```bash
npm install
cp .env.example .env        # Supabase URL + publishable key
npm run dev                 # http://localhost:8080
```

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
- A happ can be scheduled up to 60 days ahead (`starts_at`). Until then it
  shows on the map faded, nobody can post to it, and its 2-hour activity
  window only starts at the start time.
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

The map is limited to Greater Sydney, as in the original. Change `MAP_BOUNDS`
and `MAP_CENTER` in `src/lib/constants.ts` to open it up.

---

## What changed from the original

### Design

- **One theme:** warm dark charcoal (`#1d1b18`) that deepens into an ombré,
  with film grain, and orange highlights (`#e44d18`). Red is used only for
  Dead Happs.
- **Living brand texture:** the wordmark, logo and orange buttons use the
  glitch-art texture (`public/textures/`). Yellow, red and amber blobs drift
  slowly through it, and a hot spot follows your finger when you slide it
  across (`src/lib/glitch.ts`). Text and the logo use a cut of the texture
  with no black in it.
- **Waze-style map screen:** your avatar top-left and messages top-right; a
  big orange **+** to start a happ; a search pill at the bottom. A "You're
  here" card with **Post** and **DH** springs up only when you're actually at a
  happ.
- **Happs open as a card over the map** (`/happ/:id`), with the story ring,
  who's there, and Join & post. Search opens as a sheet listing what's on
  nearest to you, then what's coming up.
- **Plan ahead:** a new happ can start **now** or **later** (pick a date and
  time). Scheduled happs sit faded on the map with their start time and open
  for stories when they begin.
- **Put it anywhere:** the happ's location defaults to where you are; tap it to
  drag a pin on a map or search for a venue or address.
- **Springs everywhere:** buttons squish when pressed, sheets spring up and
  swipe down to close, markers drop in with a bounce, screens slide over the
  map and away again, stories swipe left/right and down to close, tabs slide,
  and chat bubbles pop in.
- **Simpler:** signed-in users open straight onto the map; the colour-scheme
  picker and light mode are gone; settings are just notifications, install and
  sign out.

### Bugs fixed

**Posting and camera**
- Photo posts never saved on the original backend: its `media_type` check
  rejected the label the app sent, and the old app hid the error. Fixed.
- If a new happ's first post failed, trying again created another copy of the
  happ. A retry now posts to the happ that was already created.
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
- Participant counts were set to 1 on creation and never updated (and on the
  original backend, a trigger then added 1 more, so every new happ showed two
  people).
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
- Push could never work on the original backend: it has no
  `push_subscriptions` table.

## Project structure

```
src/
  pages/            one file per screen (Welcome, Map, CreateHapp, Story, Profile, Camera, Chat…)
  components/       shared UI (HappMap, map/ sheets, motion springs) and ui/ primitives
  contexts/         Auth and Push providers
  hooks/            geolocation, realtime, unread count, install prompt
  lib/              api (backend access + legacy fallback), draft store, media, Mapbox
  integrations/supabase/   typed client + database types
  sw.ts             service worker (precache + push)
supabase/
  migrations/       full database schema
  functions/        edge functions
```
