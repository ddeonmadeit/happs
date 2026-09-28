-- =============================================================================
-- Scheduled happs
--
-- A happ can be set up ahead of time. Until `starts_at` it is "upcoming": it
-- shows on the map (faded) but nobody can post to it yet. Its activity clock
-- starts at the start time, so it doesn't expire before it begins.
-- =============================================================================

alter table public.happs add column starts_at timestamptz not null default now();

create index happs_starts_at_idx on public.happs (starts_at);

create or replace function public.handle_happ_schedule()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A start time in the past (or a slow clock) just means "now".
  new.starts_at := greatest(coalesce(new.starts_at, now()), now());
  if new.starts_at > now() + interval '60 days' then
    raise exception 'Happs can be scheduled up to 60 days ahead' using errcode = '22023';
  end if;
  new.last_activity_at := greatest(coalesce(new.last_activity_at, now()), new.starts_at);
  return new;
end;
$$;

create trigger happs_schedule
  before insert on public.happs
  for each row execute function public.handle_happ_schedule();

-- No stories before a happ has started (with the same minute of grace the
-- app allows for phone clocks).
create or replace function public.check_happ_started()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.happs h where h.id = new.happ_id and h.starts_at > now() + interval '1 minute') then
    raise exception 'This happ hasn''t started yet' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger posts_require_started
  before insert on public.posts
  for each row execute function public.check_happ_started();

revoke execute on function public.handle_happ_schedule() from public, anon, authenticated;
revoke execute on function public.check_happ_started() from public, anon, authenticated;

-- The map: live happs as before, plus upcoming ones (the return type changes,
-- so the function is recreated).
drop function public.get_map_happs();

create function public.get_map_happs()
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
  created_at        timestamptz,
  starts_at         timestamptz
)
language sql
stable
set search_path = ''
as $$
  select h.id, h.name, h.latitude, h.longitude, h.suburb, h.icon_url,
         h.is_active, h.has_livestream, h.participant_count,
         (select count(*) from public.posts p where p.happ_id = h.id) as post_count,
         h.last_activity_at, h.created_at, h.starts_at
    from public.happs h
   where greatest(h.created_at, h.starts_at) > now() - interval '24 hours'
     and greatest(h.last_activity_at, h.starts_at) > now() - interval '2 hours'
   order by h.starts_at > now(), h.last_activity_at desc
   limit 500;
$$;

grant execute on function public.get_map_happs() to anon, authenticated;
