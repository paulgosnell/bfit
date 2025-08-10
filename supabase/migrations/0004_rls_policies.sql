-- Example granular policies
-- For MVP we rely on service role in Edge Functions. Keep select disabled for anon.

-- Allow service role (bypass RLS) using supabase internal role; no SQL change needed.

-- If later using authenticated users, wire JWT with tg id in custom claim and implement policies accordingly.


