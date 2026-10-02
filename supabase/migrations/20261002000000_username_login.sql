-- Sign in with a username as well as an email.
--
-- Supabase Auth signs in by email. login_email() turns a username and
-- password into that account's email, but only when the password is right,
-- so nobody can look up someone's email from their username. The app then
-- signs in with the email as usual. Ten wrong passwords for a username lock
-- username sign-in for that account for 15 minutes (email sign-in still works).

create table public.login_attempts (
  username     text not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_username_idx on public.login_attempts (username, attempted_at desc);

alter table public.login_attempts enable row level security;
-- No policies: only login_email() touches this table.

create or replace function public.login_email(p_username text, p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(regexp_replace(btrim(coalesce(p_username, '')), '^@', ''));
  v_email    text;
  v_hash     text;
begin
  if v_username = '' or coalesce(p_password, '') = '' then
    return null;
  end if;

  delete from public.login_attempts where attempted_at < now() - interval '1 day';
  if (select count(*) from public.login_attempts
       where username = v_username and attempted_at > now() - interval '15 minutes') >= 10 then
    raise exception 'Too many attempts. Try again in a few minutes, or sign in with your email.';
  end if;

  select u.email, u.encrypted_password
    into v_email, v_hash
    from public.profiles p
    join auth.users u on u.id = p.user_id
   where p.username = v_username;

  if v_hash is not null and extensions.crypt(p_password, v_hash) = v_hash then
    delete from public.login_attempts where username = v_username;
    return v_email;
  end if;

  insert into public.login_attempts (username) values (v_username);
  return null;
end;
$$;

revoke execute on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;
