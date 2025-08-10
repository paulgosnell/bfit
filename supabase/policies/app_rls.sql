-- Explicit RLS policies for app-level access via Supabase Auth (optional for MVP)
-- These policies assume JWT has auth.uid() = users.id

-- USERS: self-read only
drop policy if exists users_read_self on public.users;
create policy users_read_self on public.users
for select to authenticated
using (id = auth.uid());

-- PROFILES: self or league admin over members
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.league_members lm_admin
    join public.league_members lm_user on lm_user.league_id = lm_admin.league_id
    where lm_admin.user_id = auth.uid()
      and lm_admin.role = 'admin'
      and lm_user.user_id = profiles.user_id
  )
);

-- ACTIVITIES: self or league admin over members
drop policy if exists activities_read_self_or_admin on public.activities;
create policy activities_read_self_or_admin on public.activities
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.league_members lm_admin
    join public.league_members lm_user on lm_user.league_id = lm_admin.league_id
    where lm_admin.user_id = auth.uid()
      and lm_admin.role = 'admin'
      and lm_user.user_id = activities.user_id
  )
);

-- POINTS: self or league admin over members
drop policy if exists points_read_self_or_admin on public.points;
create policy points_read_self_or_admin on public.points
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.league_members lm_admin
    join public.league_members lm_user on lm_user.league_id = lm_admin.league_id
    where lm_admin.user_id = auth.uid()
      and lm_admin.role = 'admin'
      and lm_user.user_id = points.user_id
  )
);

-- PROVIDERS: self only
drop policy if exists providers_read_self on public.providers;
create policy providers_read_self on public.providers
for select to authenticated
using (user_id = auth.uid());


