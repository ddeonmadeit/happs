-- =============================================================================
-- Tickets
--
-- Hosts can charge for a happ. Payments run through Stripe Connect using
-- "separate charges and transfers": the buyer pays The Happs, and after the
-- event the host's share (the price minus the 13% platform fee) is
-- transferred to their Stripe account. That lets hosts start selling
-- straight away and set up payouts whenever they like, and refunds before
-- the event never have to claw money back from a host.
--
-- Everything that touches money happens in edge functions with the service
-- role (supabase/functions/*). The browser can read its own tickets and a
-- host can read and check in the tickets for their happs, nothing more.
-- =============================================================================

alter table public.happs
  add column price_cents  integer     not null default 0,
  add column currency     text        not null default 'aud',
  add column capacity     integer,
  add column cancelled_at timestamptz,
  add constraint happs_price_range check (price_cents = 0 or price_cents between 200 and 100000),
  add constraint happs_capacity_positive check (capacity is null or capacity > 0),
  add constraint happs_currency_code check (currency ~ '^[a-z]{3}$');

-- Each host's Stripe Express account (written by the stripe-* functions).
create table public.stripe_accounts (
  user_id           uuid primary key references public.profiles (user_id) on delete cascade,
  stripe_account_id text not null unique,
  details_submitted boolean not null default false,
  charges_enabled   boolean not null default false,
  payouts_enabled   boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.tickets (
  id                       uuid primary key default gen_random_uuid(),
  happ_id                  uuid not null references public.happs (id) on delete restrict,
  user_id                  uuid not null references public.profiles (user_id) on delete restrict,
  -- reserved: paying now (holds a spot for 15 minutes)
  -- valid:    paid; lets you in
  -- refunded: money returned
  -- expired:  payment never completed
  status                   text not null default 'reserved'
                           check (status in ('reserved', 'valid', 'refunded', 'expired')),
  -- What goes on the door QR code.
  code                     text not null unique
                           default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  amount_cents             integer not null check (amount_cents > 0),
  platform_fee_cents       integer not null check (platform_fee_cents >= 0),
  currency                 text not null,
  reserved_until           timestamptz not null default now() + interval '15 minutes',
  stripe_payment_intent_id text unique,
  stripe_charge_id         text,
  stripe_transfer_id       text,
  paid_at                  timestamptz,
  refunded_at              timestamptz,
  transferred_at           timestamptz,
  checked_in_at            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index tickets_happ_idx on public.tickets (happ_id, status);
create index tickets_user_idx on public.tickets (user_id, created_at desc);
-- One live ticket per person per happ.
create unique index tickets_one_per_person
  on public.tickets (happ_id, user_id)
  where status in ('reserved', 'valid');

create trigger stripe_accounts_updated_at before update on public.stripe_accounts
  for each row execute function public.set_updated_at();
create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Rules the database enforces
-- ---------------------------------------------------------------------------

-- Tickets that count against a happ's capacity: paid, or being paid for now.
create or replace function public.tickets_taken(p_happ_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.tickets t
   where t.happ_id = p_happ_id
     and (t.status = 'valid' or (t.status = 'reserved' and t.reserved_until > now()));
$$;

-- Once tickets are sold, the price can't change and the capacity can't drop
-- below what's been sold. A paid happ is cancelled (and refunded) rather
-- than deleted, so the records stay.
create or replace function public.guard_happ_tickets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sold integer;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.tickets t where t.happ_id = old.id) then
      raise exception 'This happ has tickets; cancel it instead' using errcode = '22023';
    end if;
    return old;
  end if;

  if new.price_cents is distinct from old.price_cents or new.currency is distinct from old.currency then
    if exists (select 1 from public.tickets t where t.happ_id = old.id and t.status in ('reserved', 'valid', 'refunded')) then
      raise exception 'The price can''t change once tickets are sold' using errcode = '22023';
    end if;
  end if;
  if new.capacity is not null and new.capacity is distinct from old.capacity then
    v_sold := public.tickets_taken(old.id);
    if new.capacity < v_sold then
      raise exception 'You''ve already sold % tickets', v_sold using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

create trigger happs_guard_tickets
  before update or delete on public.happs
  for each row execute function public.guard_happ_tickets();

-- Stories at a paid happ are for ticket holders (and the host).
create or replace function public.check_post_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.happs h
     where h.id = new.happ_id
       and h.price_cents > 0
       and h.creator_id <> new.user_id
       and not exists (
         select 1 from public.tickets t
          where t.happ_id = h.id and t.user_id = new.user_id and t.status = 'valid'
       )
  ) then
    raise exception 'You need a ticket to post here' using errcode = '22023';
  end if;
  if exists (select 1 from public.happs h where h.id = new.happ_id and h.cancelled_at is not null) then
    raise exception 'This happ was cancelled' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger posts_require_ticket
  before insert on public.posts
  for each row execute function public.check_post_ticket();

-- The host scans a ticket at the door.
create or replace function public.check_in_ticket(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_happ   public.happs;
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_first  boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  -- QR codes carry "HAPPS-<code>"; people can also type the code.
  if v_code like 'HAPPS%' then
    v_code := substr(v_code, 6);
  end if;

  select * into v_ticket from public.tickets where code = v_code;
  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;
  select * into v_happ from public.happs where id = v_ticket.happ_id;
  if v_happ.creator_id <> (select auth.uid()) then
    return jsonb_build_object('result', 'wrong_happ');
  end if;
  if v_ticket.status <> 'valid' then
    return jsonb_build_object('result', 'not_valid', 'status', v_ticket.status, 'user_id', v_ticket.user_id);
  end if;

  v_first := v_ticket.checked_in_at is null;
  if v_first then
    update public.tickets set checked_in_at = now() where id = v_ticket.id
    returning * into v_ticket;
  end if;
  return jsonb_build_object(
    'result', case when v_first then 'admitted' else 'already_checked_in' end,
    'ticket_id', v_ticket.id,
    'user_id', v_ticket.user_id,
    'checked_in_at', v_ticket.checked_in_at
  );
end;
$$;

-- The map leaves out cancelled happs, and now says what entry costs and who
-- is hosting (so "Post" can send people to buy a ticket first).
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
  starts_at         timestamptz,
  price_cents       integer,
  currency          text,
  creator_id        uuid
)
language sql
stable
set search_path = ''
as $$
  select h.id, h.name, h.latitude, h.longitude, h.suburb, h.icon_url,
         h.is_active, h.has_livestream, h.participant_count,
         (select count(*) from public.posts p where p.happ_id = h.id) as post_count,
         h.last_activity_at, h.created_at, h.starts_at,
         h.price_cents, h.currency, h.creator_id
    from public.happs h
   where h.cancelled_at is null
     and greatest(h.created_at, h.starts_at) > now() - interval '24 hours'
     and greatest(h.last_activity_at, h.starts_at) > now() - interval '2 hours'
   order by h.starts_at > now(), h.last_activity_at desc
   limit 500;
$$;

grant execute on function public.get_map_happs() to anon, authenticated;

revoke execute on function public.tickets_taken(uuid) from public, anon;
revoke execute on function public.guard_happ_tickets() from public, anon, authenticated;
revoke execute on function public.check_post_ticket() from public, anon, authenticated;
revoke execute on function public.check_in_ticket(text) from public, anon;
grant execute on function public.tickets_taken(uuid) to authenticated;
grant execute on function public.check_in_ticket(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: read-only from the app; writes go through functions.
-- ---------------------------------------------------------------------------
alter table public.stripe_accounts enable row level security;
alter table public.tickets enable row level security;

create policy "Hosts can see their own payout account"
  on public.stripe_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "People can see their own tickets"
  on public.tickets for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Hosts can see tickets for their happs"
  on public.tickets for select to authenticated
  using (exists (select 1 from public.happs h where h.id = happ_id and h.creator_id = (select auth.uid())));

grant select on public.stripe_accounts to authenticated;
grant select on public.tickets to authenticated;
revoke insert, update, delete on public.stripe_accounts from anon, authenticated;
revoke insert, update, delete on public.tickets from anon, authenticated;

-- Hosts see ticket changes live (sales, check-ins).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;
end;
$$;
