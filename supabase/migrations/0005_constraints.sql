-- Basic sanity: prevent absurd manual steps > 100k/day at DB level? We keep in app logic. Indexes already defined.
-- Optional unique for Strava upsert key: user_id + start_time + type
create unique index if not exists uniq_activity_user_time_type on public.activities(user_id, start_time, type);

