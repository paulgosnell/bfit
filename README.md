# BFIT MVP

Compete-to-earn fitness bot for Telegram with Supabase Edge Functions (Deno + TypeScript) and a thin web mini-app.

## Stack
- Supabase Edge Functions with Hono (Deno)
- Postgres (Supabase)
- Telegram Bot API (webhook)
- Strava OAuth + Webhooks

## Structure

```
/edge/functions
  /telegram-webhook/index.ts
  /strava-webhook/index.ts
  /oauth-strava/index.ts
  /utils/{db.ts, telegram.ts, points.ts}
/supabase
  /migrations/0001_init.sql
  /policies/rls.sql
  /seed/seed.sql
/web/public/index.html
/tests/points.test.ts
telegram-commands.json
```

## Environment

Set via Supabase secrets (placeholders as TODOs):

```
TELEGRAM_BOT_TOKEN=__set_in_env__
TELEGRAM_WEBHOOK_SECRET=__random_string_for_route__
PUBLIC_BOT_USERNAME=@the_bfit_bot
APP_BASE_URL=https://app.bfit.example
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STRAVA_CLIENT_ID=...
STRAVA_CLIENT_SECRET=...
STRAVA_WEBHOOK_VERIFY_TOKEN=__random__
```

## Local Dev

1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Init + start:
   ```bash
   supabase init
   supabase start
   ```
3. Apply schema and seed:
   ```bash
   supabase db reset  # applies migrations and seeds
   ```
4. Run tests (Deno):
   ```bash
   deno test -A tests/points.test.ts
   ```

## Deploy

```bash
# Deploy edge functions
supabase functions deploy telegram-webhook strava-webhook oauth-strava

# Set secrets
supabase secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... APP_BASE_URL=... \
  STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=... STRAVA_WEBHOOK_VERIFY_TOKEN=...

# Set Telegram webhook
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=https://<project>.functions.supabase.co/telegram/webhook/${TELEGRAM_WEBHOOK_SECRET}"

# Create Strava subscription (replace callback URL)
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=$STRAVA_CLIENT_ID -d client_secret=$STRAVA_CLIENT_SECRET \
  -d callback_url=https://<project>.functions.supabase.co/webhooks/strava \
  -d verify_token=$STRAVA_WEBHOOK_VERIFY_TOKEN
```

## Golden Path (E2E)

1) Register Telegram commands:
```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands" \
  -H 'content-type: application/json' \
  -d @telegram-commands.json
```

2) /start in Telegram: user is upserted, CTA keyboard appears

3) Tap Join Public League or send /join

4) Connect Strava at `APP_BASE_URL` → redirects to `/oauth/strava/start`

5) Trigger test activity insert (simulate):
```bash
curl -X POST https://<project>.functions.supabase.co/webhooks/strava \
  -H 'content-type: application/json' \
  -d '{"object_type":"activity","aspect_type":"create","owner_id":"123","object_id":"456"}'
```

6) /leaderboard shows top 10 (updates within ~60s)

## Notes

- Points calculation in `edge/functions/utils/points.ts`. Tests in `tests/points.test.ts`.
- Idempotency: `processed_updates` stores Telegram `update_id`.
- RLS enabled with default deny; production reads happen via Edge Functions with service role.
- TODO: Wire OAuth state to actual `user_id` and store Strava athlete id in providers (`provider_user_id`).


