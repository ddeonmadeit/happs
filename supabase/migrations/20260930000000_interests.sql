-- Interests, brand accounts and "Suggested for you".
--
-- Profiles pick what they're into (up to 10 interests from a fixed list) and
-- can be a person or a brand (venue, promoter, label…). suggest_profiles()
-- ranks accounts to follow by shared interests, people you follow who follow
-- them, whether they follow you, and popularity.

alter table public.profiles
  add column interests text[] not null default '{}',
  add column account_type text not null default 'person',
  add column brand_category text,
  add constraint profiles_interests_valid check (
    cardinality(interests) <= 10
    and interests <@ array[
      'music', 'nightlife', 'food', 'drinks', 'art', 'fashion', 'sport', 'fitness',
      'outdoors', 'beach', 'comedy', 'film', 'markets', 'tech', 'wellness', 'gaming',
      'photography', 'culture'
    ]::text[]
  ),
  add constraint profiles_account_type_valid check (account_type in ('person', 'brand')),
  add constraint profiles_brand_category_length check (brand_category is null or char_length(brand_category) <= 30);

create index profiles_interests_idx on public.profiles using gin (interests);
create index profiles_account_type_idx on public.profiles (account_type);

-- Accounts to follow. p_kind narrows to 'person' or 'brand'; p_like ranks by
-- similarity to another profile (for "Suggested for you" after following
-- someone) instead of to you.
create or replace function public.suggest_profiles(
  p_limit integer default 20,
  p_kind text default null,
  p_like uuid default null
)
returns table (
  user_id          uuid,
  username         text,
  display_name     text,
  avatar_url       text,
  account_type     text,
  brand_category   text,
  interests        text[],
  shared_interests text[],
  mutual_count     integer,
  mutual_username  text,
  follows_you      boolean,
  followers        integer,
  reason           text
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as id
  ),
  basis as (
    -- Whose interests to match: yours, or the profile you're looking at.
    select coalesce(
      (select p.interests from public.profiles p where p.user_id = p_like),
      (select p.interests from public.profiles p where p.user_id = (select id from me)),
      '{}'
    ) as interests
  ),
  my_follows as (
    select f.following_id as id from public.follows f where f.follower_id = (select id from me)
  ),
  candidates as (
    select p.*,
           array(select unnest(p.interests) intersect select unnest((select interests from basis))) as shared,
           (select count(*)::int from public.follows f where f.following_id = p.user_id) as follower_count,
           (select count(*)::int from public.follows f
             where f.following_id = p.user_id and f.follower_id in (select id from my_follows)) as mutuals,
           (select pr.username from public.follows f
              join public.profiles pr on pr.user_id = f.follower_id
             where f.following_id = p.user_id and f.follower_id in (select id from my_follows)
             order by f.created_at desc limit 1) as mutual_name,
           exists (select 1 from public.follows f
                    where f.follower_id = p.user_id and f.following_id = (select id from me)) as follows_me,
           (p_like is not null and exists (select 1 from public.follows f
                    where f.follower_id = p_like and f.following_id = p.user_id)) as liked_by_basis
      from public.profiles p
     where p.username is not null
       and p.user_id <> coalesce((select id from me), '00000000-0000-0000-0000-000000000000'::uuid)
       and p.user_id <> coalesce(p_like, '00000000-0000-0000-0000-000000000000'::uuid)
       and p.user_id not in (select id from my_follows)
       and (p_kind is null or p.account_type = p_kind)
  )
  select c.user_id, c.username, c.display_name, c.avatar_url, c.account_type, c.brand_category,
         c.interests, c.shared, c.mutuals, c.mutual_name, c.follows_me, c.follower_count,
         case
           when c.follows_me then 'Follows you'
           when c.mutuals > 1 then 'Followed by @' || c.mutual_name || ' + ' || (c.mutuals - 1) || ' more'
           when c.mutuals = 1 then 'Followed by @' || c.mutual_name
           when cardinality(c.shared) > 0 then 'shared'
           when c.created_at > now() - interval '14 days' then 'New to The Happs'
           else 'Popular on The Happs'
         end as reason
    from candidates c
   order by (cardinality(c.shared) * 3
             + c.mutuals * 4
             + case when c.follows_me then 6 else 0 end
             + case when c.liked_by_basis then 3 else 0 end
             + ln(1 + c.follower_count)
             + case when c.avatar_url is not null then 0.5 else 0 end) desc,
            c.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke execute on function public.suggest_profiles(integer, text, uuid) from public, anon;
grant execute on function public.suggest_profiles(integer, text, uuid) to authenticated;
