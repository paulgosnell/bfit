-- Example RLS policies for service-role usage and league admin reads
-- In production, you will perform reads via Edge Functions (service role). These policies are conservative placeholders.

alter table public.users enable row level security;
alter table public.profiles enable row level security;
alter table public.activities enable row level security;
alter table public.points enable row level security;
alter table public.providers enable row level security;

-- Self-read using JWT's "sub" if you wire auth; placeholder disabled here.
-- create policy "users_read_self" on public.users for select using (id = auth.uid());


