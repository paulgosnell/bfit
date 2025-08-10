-- Enable RLS
alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.points enable row level security;
alter table public.providers enable row level security;

-- Default deny
drop policy if exists "users_select_none" on public.users;
create policy "users_select_none" on public.users for select to anon using (false);

drop policy if exists "profiles_select_none" on public.profiles;
create policy "profiles_select_none" on public.profiles for select to anon using (false);

drop policy if exists "activities_select_none" on public.activities;
create policy "activities_select_none" on public.activities for select to anon using (false);

drop policy if exists "points_select_none" on public.points;
create policy "points_select_none" on public.points for select to anon using (false);

drop policy if exists "providers_select_none" on public.providers;
create policy "providers_select_none" on public.providers for select to anon using (false);

-- TODO: add authenticated policies once Auth is wired, to allow a user to read their own rows
-- Example:
-- create policy "users_select_self" on public.users for select to authenticated using (id = auth.uid());


