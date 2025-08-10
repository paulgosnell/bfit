-- Seed default public league
insert into public.leagues (name, description, is_public, week_start_dow)
values ('BFIT Public League', 'Everyone welcome', true, 1)
on conflict do nothing;


