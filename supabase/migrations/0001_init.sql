-- BFIT initial schema
create extension if not exists pgcrypto;

-- users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  username text,
  first_name text,
  last_name text,
  created_at timestamptz default now()
);

-- profiles 1:1
create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  avatar_url text,
  country text,
  bio text
);

-- leagues
create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_public boolean default true,
  week_start_dow int default 1,
  created_by uuid references public.users(id),
  created_at timestamptz default now()
);

-- league_members
create table if not exists public.league_members (
  league_id uuid references public.leagues(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  role text default 'member',
  joined_at timestamptz default now(),
  primary key (league_id, user_id)
);

-- providers (connected accounts)
create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  provider text not null,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  provider_user_id text, -- extension: map Strava athlete id for webhooks
  created_at timestamptz default now()
);

-- activities
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  source text not null,
  type text not null,
  start_time timestamptz not null,
  duration_seconds int,
  distance_meters int,
  steps int,
  raw jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_activities_user_time on public.activities(user_id, start_time desc);

-- points
create table if not exists public.points (
  id bigint generated always as identity primary key,
  user_id uuid references public.users(id),
  activity_id uuid references public.activities(id),
  week_start_date date not null,
  points int not null,
  created_at timestamptz default now()
);
create index if not exists idx_points_user_week on public.points(user_id, week_start_date);

-- webhook_logs
create table if not exists public.webhook_logs (
  id bigint generated always as identity primary key,
  source text,
  payload jsonb,
  received_at timestamptz default now()
);

-- processed_updates for Telegram idempotency
create table if not exists public.processed_updates (
  update_id bigint primary key
);

-- weekly leaderboard view
create or replace view public.weekly_leaderboard_view as
select p.user_id, lm.league_id, p.week_start_date, sum(p.points) as points_total
from public.points p
join public.league_members lm on lm.user_id = p.user_id
group by p.user_id, lm.league_id, p.week_start_date;


