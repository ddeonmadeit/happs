-- The owner's dashboard (/dash).
--
-- app_admins lists who can see it. Nobody is an admin by default: an admin
-- claim code (stored only as a hash, set outside the repo) turns the account
-- that redeems it into one, once. Every admin_* function checks is_admin().

create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.app_admin_claims (
  code_hash  text primary key,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
alter table public.app_admin_claims enable row level security;
-- No policies: only the security-definer functions below touch these.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

-- Redeem an admin code. Codes work once.
create or replace function public.claim_admin(p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text := encode(sha256(convert_to(coalesce(p_code, ''), 'UTF8')), 'hex');
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  delete from public.app_admin_claims where code_hash = v_hash;
  if not found then
    return false;
  end if;
  insert into public.app_admins (user_id) values (auth.uid()) on conflict do nothing;
  return true;
end;
$$;

create or replace function public.admin_guard()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
end;
$$;

-- Headline numbers and 30-day activity.
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform public.admin_guard();
  select jsonb_build_object(
    'users', (select count(*) from public.profiles where username is not null),
    'users_today', (select count(*) from public.profiles where username is not null and created_at > date_trunc('day', now())),
    'users_7d', (select count(*) from public.profiles where username is not null and created_at > now() - interval '7 days'),
    'brands', (select count(*) from public.profiles where account_type = 'brand'),
    'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'happs', (select count(*) from public.happs),
    'happs_live', (select count(*) from public.get_map_happs() m where m.starts_at <= now()),
    'happs_upcoming', (select count(*) from public.happs where starts_at > now() and cancelled_at is null),
    'happs_7d', (select count(*) from public.happs where created_at > now() - interval '7 days'),
    'posts', (select count(*) from public.posts),
    'posts_7d', (select count(*) from public.posts where created_at > now() - interval '7 days'),
    'messages_7d', (select count(*) from public.messages where created_at > now() - interval '7 days'),
    'follows', (select count(*) from public.follows),
    'push_subscribers', (select count(distinct user_id) from public.push_subscriptions),
    'paid_happs', (select count(*) from public.happs where price_cents > 0),
    'tickets_sold', (select count(*) from public.tickets where status = 'valid'),
    'tickets_refunded', (select count(*) from public.tickets where status = 'refunded'),
    'gross_cents', (select coalesce(sum(amount_cents), 0) from public.tickets where status = 'valid'),
    'fees_cents', (select coalesce(sum(platform_fee_cents), 0) from public.tickets where status = 'valid'),
    'refunded_cents', (select coalesce(sum(amount_cents), 0) from public.tickets where status = 'refunded'),
    'owed_to_hosts_cents', (select coalesce(sum(amount_cents - platform_fee_cents), 0) from public.tickets
                             where status = 'valid' and stripe_transfer_id is null),
    'paid_to_hosts_cents', (select coalesce(sum(amount_cents - platform_fee_cents), 0) from public.tickets
                             where status = 'valid' and stripe_transfer_id is not null),
    'hosts_with_payouts', (select count(*) from public.stripe_accounts where payouts_enabled),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day,
               'signups', (select count(*) from public.profiles p where p.created_at >= d.day and p.created_at < d.day + interval '1 day'),
               'happs', (select count(*) from public.happs h where h.created_at >= d.day and h.created_at < d.day + interval '1 day'),
               'posts', (select count(*) from public.posts p where p.created_at >= d.day and p.created_at < d.day + interval '1 day')
             ) order by d.day), '[]'::jsonb)
        from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') as d(day)
    ),
    'interests', (
      select coalesce(jsonb_object_agg(i, n), '{}'::jsonb)
        from (select unnest(interests) as i, count(*) as n from public.profiles group by 1) t
    )
  ) into v;
  return v;
end;
$$;

-- Everyone on the app, newest first, with a search over name, username and email.
create or replace function public.admin_users(p_search text default null, p_limit integer default 100, p_offset integer default 0)
returns table (
  user_id          uuid,
  email            text,
  username         text,
  display_name     text,
  avatar_url       text,
  account_type     text,
  brand_category   text,
  interests        text[],
  created_at       timestamptz,
  last_sign_in_at  timestamptz,
  posts            integer,
  happs            integer,
  followers        integer,
  following        integer,
  tickets          integer,
  is_admin         boolean,
  total            bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  return query
    select p.user_id, u.email::text, p.username, p.display_name, p.avatar_url, p.account_type, p.brand_category,
           p.interests, p.created_at, u.last_sign_in_at,
           (select count(*)::int from public.posts x where x.user_id = p.user_id),
           (select count(*)::int from public.happs x where x.creator_id = p.user_id),
           (select count(*)::int from public.follows x where x.following_id = p.user_id),
           (select count(*)::int from public.follows x where x.follower_id = p.user_id),
           (select count(*)::int from public.tickets x where x.user_id = p.user_id and x.status = 'valid'),
           exists (select 1 from public.app_admins a where a.user_id = p.user_id),
           count(*) over ()
      from public.profiles p
      join auth.users u on u.id = p.user_id
     where p_search is null or p_search = ''
        or p.username ilike '%' || p_search || '%'
        or p.display_name ilike '%' || p_search || '%'
        or u.email ilike '%' || p_search || '%'
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Recent happs with their creator and ticket sales.
create or replace function public.admin_happs(p_limit integer default 50)
returns table (
  id                uuid,
  name              text,
  suburb            text,
  icon_url          text,
  creator_id        uuid,
  creator_username  text,
  created_at        timestamptz,
  starts_at         timestamptz,
  last_activity_at  timestamptz,
  is_active         boolean,
  cancelled_at      timestamptz,
  participant_count integer,
  posts             integer,
  price_cents       integer,
  tickets_sold      integer,
  gross_cents       bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  return query
    select h.id, h.name, h.suburb, h.icon_url, h.creator_id, p.username, h.created_at, h.starts_at,
           h.last_activity_at, h.is_active, h.cancelled_at, h.participant_count,
           (select count(*)::int from public.posts x where x.happ_id = h.id),
           h.price_cents,
           (select count(*)::int from public.tickets t where t.happ_id = h.id and t.status = 'valid'),
           (select coalesce(sum(t.amount_cents), 0)::bigint from public.tickets t where t.happ_id = h.id and t.status = 'valid')
      from public.happs h
      left join public.profiles p on p.user_id = h.creator_id
     order by h.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

-- Recent ticket sales and refunds.
create or replace function public.admin_sales(p_limit integer default 50)
returns table (
  id                 uuid,
  happ_id            uuid,
  happ_name          text,
  buyer_id           uuid,
  buyer_username     text,
  status             text,
  amount_cents       integer,
  platform_fee_cents integer,
  currency           text,
  paid_at            timestamptz,
  refunded_at        timestamptz,
  transferred_at     timestamptz,
  checked_in_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard();
  return query
    select t.id, t.happ_id, h.name, t.user_id, p.username, t.status, t.amount_cents, t.platform_fee_cents,
           t.currency, t.paid_at, t.refunded_at, t.transferred_at, t.checked_in_at
      from public.tickets t
      join public.happs h on h.id = t.happ_id
      left join public.profiles p on p.user_id = t.user_id
     where t.status in ('valid', 'refunded')
     order by coalesce(t.refunded_at, t.paid_at, t.created_at) desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.claim_admin(text) from public, anon;
revoke execute on function public.admin_guard() from public, anon, authenticated;
revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_users(text, integer, integer) from public, anon;
revoke execute on function public.admin_happs(integer) from public, anon;
revoke execute on function public.admin_sales(integer) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.claim_admin(text) to authenticated;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_users(text, integer, integer) to authenticated;
grant execute on function public.admin_happs(integer) to authenticated;
grant execute on function public.admin_sales(integer) to authenticated;
