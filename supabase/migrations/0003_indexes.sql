-- Convenience indexes
create index if not exists idx_league_members_user on public.league_members(user_id);
create index if not exists idx_points_week on public.points(week_start_date);

