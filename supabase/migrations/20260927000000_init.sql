-- =============================================================================
-- The Happs — full database schema
--
-- Rebuilt from the original Lovable app. Same tables and columns the client
-- used, plus the server-side pieces the old app was missing or doing
-- unsafely from the browser:
--   * triggers that keep participant counts, activity timestamps and the
--     "Dead Happ" status consistent
--   * RPCs that replace the N+1 query loops (map, inbox, unread badge)
--   * RLS on every table and on the `media` storage bucket
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profiles (one per auth user, created automatically on sign-up)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users (id) on delete cascade,
  username     text unique,
  display_name text,
  bio          text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 50),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 150)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Happs (events pinned on the map)
-- -----------------------------------------------------------------------------
create table public.happs (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  latitude          double precision not null,
  longitude         double precision not null,
  suburb            text,
  creator_id        uuid not null references public.profiles (user_id) on delete cascade,
  icon_url          text,
  is_active         boolean not null default true,
  has_livestream    boolean not null default false,
  participant_count integer not null default 0,
  last_activity_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint happs_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint happs_description_length check (description is null or char_length(description) <= 500),
  constraint happs_latitude_range check (latitude between -90 and 90),
  constraint happs_longitude_range check (longitude between -180 and 180)
);

create index happs_last_activity_idx on public.happs (last_activity_at desc);
create index happs_created_at_idx on public.happs (created_at desc);
create index happs_creator_idx on public.happs (creator_id);

create trigger happs_set_updated_at
  before update on public.happs
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Happ participants (who has joined / posted, and their Dead Happ vote)
-- -----------------------------------------------------------------------------
create table public.happ_participants (
  id               uuid primary key default gen_random_uuid(),
  happ_id          uuid not null references public.happs (id) on delete cascade,
  user_id          uuid not null references public.profiles (user_id) on delete cascade,
  is_active        boolean not null default true,
  is_livestreaming boolean not null default false,
  dh_pressed       boolean not null default false,
  dh_pressed_at    timestamptz,
  joined_at        timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  constraint happ_participants_unique unique (happ_id, user_id)
);

create index happ_participants_user_idx on public.happ_participants (user_id, joined_at desc);

-- -----------------------------------------------------------------------------
-- Posts (photo / video stories inside a happ)
-- -----------------------------------------------------------------------------
create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  happ_id    uuid not null references public.happs (id) on delete cascade,
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  media_url  text not null,
  media_type text not null default 'image',
  caption    text,
  created_at timestamptz not null default now(),
  constraint posts_media_type check (media_type in ('image', 'video')),
  constraint posts_caption_length check (caption is null or char_length(caption) <= 500)
);

create index posts_happ_idx on public.posts (happ_id, created_at desc);
create index posts_user_idx on public.posts (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Likes & comments
-- -----------------------------------------------------------------------------
create table public.post_likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint post_likes_unique unique (post_id, user_id)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (user_id) on delete cascade,
  content    text not null,
  created_at timestamptz not null default now(),
  constraint comments_content_length check (char_length(btrim(content)) between 1 and 500)
);

create index comments_post_idx on public.comments (post_id, created_at);

-- -----------------------------------------------------------------------------
-- Follows
-- -----------------------------------------------------------------------------
create table public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references public.profiles (user_id) on delete cascade,
  following_id uuid not null references public.profiles (user_id) on delete cascade,
  created_at   timestamptz not null default now(),
  constraint follows_unique unique (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);

create index follows_following_idx on public.follows (following_id);

-- -----------------------------------------------------------------------------
-- Direct messages
-- -----------------------------------------------------------------------------
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  participant_1   uuid not null references public.profiles (user_id) on delete cascade,
  participant_2   uuid not null references public.profiles (user_id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint conversations_not_self check (participant_1 <> participant_2)
);

-- One conversation per pair of users, whichever way round they were stored.
create unique index conversations_pair_idx
  on public.conversations (least(participant_1, participant_2), greatest(participant_1, participant_2));
create index conversations_p1_idx on public.conversations (participant_1, last_message_at desc);
create index conversations_p2_idx on public.conversations (participant_2, last_message_at desc);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (user_id) on delete cascade,
  content         text not null,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint messages_content_length check (char_length(btrim(content)) between 1 and 2000)
);

create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where not is_read;

-- -----------------------------------------------------------------------------
-- Web push subscriptions
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (user_id) on delete cascade,
  endpoint            text not null unique,
  p256dh              text not null,
  auth                text not null,
  -- Rounded (~100 m) last known location, used for "new happ nearby" alerts.
  latitude            double precision,
  longitude           double precision,
  location_updated_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_set_updated_at
  before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

-- Written only by the send-push edge function (service role) so each message
-- or happ triggers at most one round of notifications.
create table public.notification_log (
  kind       text not null,
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  primary key (kind, ref_id)
);

-- =============================================================================
-- Internal helpers & triggers
-- =============================================================================

-- A happ is "dead" once more than half of its participants have pressed DH.
create or replace function public.recompute_happ_status(p_happ_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.happs h
     set is_active = not coalesce((
           select count(*) filter (where hp.dh_pressed) * 2 > count(*)
             from public.happ_participants hp
            where hp.happ_id = p_happ_id
         ), false)
   where h.id = p_happ_id;
$$;

create or replace function public.sync_participant_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_happ_id uuid;
begin
  if tg_op = 'DELETE' then
    v_happ_id := old.happ_id;
  else
    v_happ_id := new.happ_id;
  end if;

  update public.happs h
     set participant_count = (
       select count(*) from public.happ_participants hp where hp.happ_id = v_happ_id
     )
   where h.id = v_happ_id;

  if tg_op = 'DELETE' then
    perform public.recompute_happ_status(v_happ_id);
  end if;

  return null;
end;
$$;

create trigger happ_participants_sync_count
  after insert or delete on public.happ_participants
  for each row execute function public.sync_participant_count();

-- The creator of a happ is always its first participant.
create or replace function public.handle_new_happ()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.happ_participants (happ_id, user_id, is_active)
  values (new.id, new.creator_id, true)
  on conflict (happ_id, user_id) do nothing;
  return null;
end;
$$;

create trigger happs_add_creator
  after insert on public.happs
  for each row execute function public.handle_new_happ();

-- Posting joins you to the happ, bumps its activity and clears your own DH
-- vote (you're clearly still there).
create or replace function public.handle_new_post()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.happ_participants (happ_id, user_id, is_active, last_activity_at)
  values (new.happ_id, new.user_id, true, now())
  on conflict (happ_id, user_id) do update
    set is_active        = true,
        last_activity_at = now(),
        dh_pressed       = false,
        dh_pressed_at    = null;

  update public.happs set last_activity_at = now() where id = new.happ_id;
  perform public.recompute_happ_status(new.happ_id);
  return null;
end;
$$;

create trigger posts_after_insert
  after insert on public.posts
  for each row execute function public.handle_new_post();

create or replace function public.handle_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.handle_new_message();

create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversations c
     where c.id = p_conversation_id
       and (select auth.uid()) in (c.participant_1, c.participant_2)
  );
$$;

-- =============================================================================
-- RPCs used by the app
-- =============================================================================

-- Happs visible on the map: created in the last 24 h and active in the last 2 h.
create or replace function public.get_map_happs()
returns table (
  id                uuid,
  name              text,
  latitude          double precision,
  longitude         double precision,
  suburb            text,
  icon_url          text,
  is_active         boolean,
  has_livestream    boolean,
  participant_count integer,
  post_count        bigint,
  last_activity_at  timestamptz,
  created_at        timestamptz
)
language sql
stable
set search_path = ''
as $$
  select h.id, h.name, h.latitude, h.longitude, h.suburb, h.icon_url,
         h.is_active, h.has_livestream, h.participant_count,
         (select count(*) from public.posts p where p.happ_id = h.id) as post_count,
         h.last_activity_at, h.created_at
    from public.happs h
   where h.created_at > now() - interval '24 hours'
     and h.last_activity_at > now() - interval '2 hours'
   order by h.last_activity_at desc
   limit 500;
$$;

-- Toggle your "Dead Happ" vote. Only participants can vote.
create or replace function public.toggle_dead_happ(p_happ_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_pressed   boolean;
  v_is_active boolean;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update public.happ_participants hp
     set dh_pressed    = not hp.dh_pressed,
         dh_pressed_at = case when hp.dh_pressed then null else now() end
   where hp.happ_id = p_happ_id
     and hp.user_id = v_uid
  returning hp.dh_pressed into v_pressed;

  if not found then
    raise exception 'You need to be a participant in this happ' using errcode = 'P0001';
  end if;

  perform public.recompute_happ_status(p_happ_id);

  update public.happs h
     set last_activity_at = now()
   where h.id = p_happ_id
  returning h.is_active into v_is_active;

  return jsonb_build_object('dh_pressed', v_pressed, 'is_active', v_is_active);
end;
$$;

-- Inbox: every conversation with the other person's profile, the latest
-- message and how many are unread — in one round trip.
create or replace function public.get_conversations()
returns table (
  id                  uuid,
  other_user_id       uuid,
  other_username      text,
  other_display_name  text,
  other_avatar_url    text,
  last_message        text,
  last_message_sender uuid,
  last_message_at     timestamptz,
  unread_count        bigint
)
language sql
stable
set search_path = ''
as $$
  select c.id,
         o.user_id,
         o.username,
         o.display_name,
         o.avatar_url,
         lm.content,
         lm.sender_id,
         c.last_message_at,
         (select count(*)
            from public.messages m
           where m.conversation_id = c.id
             and m.sender_id <> (select auth.uid())
             and not m.is_read)
    from public.conversations c
    join public.profiles o
      on o.user_id = case when c.participant_1 = (select auth.uid())
                          then c.participant_2 else c.participant_1 end
    left join lateral (
      select m.content, m.sender_id
        from public.messages m
       where m.conversation_id = c.id
       order by m.created_at desc
       limit 1
    ) lm on true
   where (select auth.uid()) in (c.participant_1, c.participant_2)
   order by c.last_message_at desc;
$$;

create or replace function public.get_unread_count()
returns bigint
language sql
stable
set search_path = ''
as $$
  select count(*)
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where (select auth.uid()) in (c.participant_1, c.participant_2)
     and m.sender_id <> (select auth.uid())
     and not m.is_read;
$$;

create or replace function public.get_or_create_conversation(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_other_user is null or p_other_user = v_uid then
    raise exception 'You cannot message yourself' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where user_id = p_other_user) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  select c.id into v_id
    from public.conversations c
   where least(c.participant_1, c.participant_2) = least(v_uid, p_other_user)
     and greatest(c.participant_1, c.participant_2) = greatest(v_uid, p_other_user);

  if v_id is null then
    insert into public.conversations (participant_1, participant_2)
    values (v_uid, p_other_user)
    on conflict do nothing
    returning id into v_id;

    if v_id is null then
      select c.id into v_id
        from public.conversations c
       where least(c.participant_1, c.participant_2) = least(v_uid, p_other_user)
         and greatest(c.participant_1, c.participant_2) = greatest(v_uid, p_other_user);
    end if;
  end if;

  return v_id;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages m
     set is_read = true
   where m.conversation_id = p_conversation_id
     and m.sender_id <> (select auth.uid())
     and not m.is_read
     and public.is_conversation_participant(p_conversation_id);
$$;

-- Push subscriptions are keyed by endpoint (one per browser). If someone else
-- signs in on the same browser the subscription moves to them.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh  = excluded.p256dh,
        auth    = excluded.auth;
end;
$$;

create or replace function public.update_push_location(
  p_endpoint  text,
  p_latitude  double precision,
  p_longitude double precision
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_subscriptions
     set latitude            = round(p_latitude::numeric, 3)::double precision,
         longitude           = round(p_longitude::numeric, 3)::double precision,
         location_updated_at = now()
   where endpoint = p_endpoint
     and user_id = (select auth.uid());
$$;

-- Internal helpers are not callable from the API.
revoke execute on function public.recompute_happ_status(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_happ() from public, anon, authenticated;
revoke execute on function public.handle_new_post() from public, anon, authenticated;
revoke execute on function public.handle_new_message() from public, anon, authenticated;
revoke execute on function public.sync_participant_count() from public, anon, authenticated;

-- Signed-in only RPCs.
revoke execute on function public.toggle_dead_happ(uuid) from public, anon;
revoke execute on function public.get_conversations() from public, anon;
revoke execute on function public.get_unread_count() from public, anon;
revoke execute on function public.get_or_create_conversation(uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
revoke execute on function public.update_push_location(text, double precision, double precision) from public, anon;

grant execute on function public.get_map_happs() to anon, authenticated;
grant execute on function public.is_conversation_participant(uuid) to authenticated;
grant execute on function public.toggle_dead_happ(uuid) to authenticated;
grant execute on function public.get_conversations() to authenticated;
grant execute on function public.get_unread_count() to authenticated;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.update_push_location(text, double precision, double precision) to authenticated;

-- =============================================================================
-- Row level security
-- =============================================================================
alter table public.profiles           enable row level security;
alter table public.happs              enable row level security;
alter table public.happ_participants  enable row level security;
alter table public.posts              enable row level security;
alter table public.post_likes         enable row level security;
alter table public.comments           enable row level security;
alter table public.follows            enable row level security;
alter table public.conversations      enable row level security;
alter table public.messages           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_log   enable row level security;

-- Profiles
create policy "Profiles are viewable by everyone"
  on public.profiles for select to anon, authenticated using (true);
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Happs
create policy "Happs are viewable by everyone"
  on public.happs for select to anon, authenticated using (true);
create policy "Signed-in users can create happs"
  on public.happs for insert to authenticated with check ((select auth.uid()) = creator_id);
create policy "Creators can update their happs"
  on public.happs for update to authenticated
  using ((select auth.uid()) = creator_id) with check ((select auth.uid()) = creator_id);
create policy "Creators can delete their happs"
  on public.happs for delete to authenticated using ((select auth.uid()) = creator_id);

-- Happ participants
create policy "Participants are viewable by everyone"
  on public.happ_participants for select to anon, authenticated using (true);
create policy "Users can join happs"
  on public.happ_participants for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own participation"
  on public.happ_participants for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can leave happs"
  on public.happ_participants for delete to authenticated using ((select auth.uid()) = user_id);

-- Posts
create policy "Posts are viewable by everyone"
  on public.posts for select to anon, authenticated using (true);
create policy "Users can create their own posts"
  on public.posts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update their own posts"
  on public.posts for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Users can delete their own posts"
  on public.posts for delete to authenticated using ((select auth.uid()) = user_id);

-- Likes
create policy "Likes are viewable by everyone"
  on public.post_likes for select to anon, authenticated using (true);
create policy "Users can like posts"
  on public.post_likes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can unlike posts"
  on public.post_likes for delete to authenticated using ((select auth.uid()) = user_id);

-- Comments
create policy "Comments are viewable by everyone"
  on public.comments for select to anon, authenticated using (true);
create policy "Users can comment"
  on public.comments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can delete their own comments"
  on public.comments for delete to authenticated using ((select auth.uid()) = user_id);

-- Follows
create policy "Follows are viewable by everyone"
  on public.follows for select to anon, authenticated using (true);
create policy "Users can follow others"
  on public.follows for insert to authenticated with check ((select auth.uid()) = follower_id);
create policy "Users can unfollow"
  on public.follows for delete to authenticated using ((select auth.uid()) = follower_id);

-- Conversations
create policy "Participants can view their conversations"
  on public.conversations for select to authenticated
  using ((select auth.uid()) in (participant_1, participant_2));
create policy "Users can start conversations they are part of"
  on public.conversations for insert to authenticated
  with check ((select auth.uid()) in (participant_1, participant_2));

-- Messages (read receipts go through mark_conversation_read)
create policy "Participants can view messages"
  on public.messages for select to authenticated
  using (public.is_conversation_participant(conversation_id));
create policy "Participants can send messages"
  on public.messages for insert to authenticated
  with check ((select auth.uid()) = sender_id and public.is_conversation_participant(conversation_id));

-- Push subscriptions (writes go through save_push_subscription)
create policy "Users can view their push subscriptions"
  on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can remove their push subscriptions"
  on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);

-- notification_log: no policies, service role only.

-- =============================================================================
-- Storage: public `media` bucket, users write only inside their own folder
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 52428800, array['image/*', 'video/*'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their media" on storage.objects;
drop policy if exists "Users can upload media to their folder" on storage.objects;
drop policy if exists "Users can update their media" on storage.objects;
drop policy if exists "Users can delete their media" on storage.objects;

-- Public URLs work without a select policy; this only lets owners list/overwrite
-- their own files (so nobody can enumerate the whole bucket).
create policy "Users can read their media"
  on storage.objects for select to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can upload media to their folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can update their media"
  on storage.objects for update to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "Users can delete their media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- =============================================================================
-- Realtime
-- =============================================================================
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach t in array array['happs', 'posts', 'happ_participants', 'messages', 'conversations'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
