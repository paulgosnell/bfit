import { Hono } from "npm:hono@4";
import { getServiceClient } from "../utils/db.ts";

const app = new Hono();

// Support both /oauth/strava/start and /oauth-strava/oauth/strava/start
app.get("/oauth/strava/start", (c) => {
  const clientId = Deno.env.get("STRAVA_CLIENT_ID") || ""; // TODO
  const appBase = Deno.env.get("APP_BASE_URL") || originFromRequest(c.req.raw);
  const redirectUri = `${appBase}/oauth/strava/callback`;
  const uid = c.req.query("uid");
  if (!uid) return c.text("Missing uid", 400);
  const state = signState(uid);
  const scope = "read,activity:read_all,profile:read_all";
  const url = `https://m.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  return c.redirect(url, 302);
});

app.get("/oauth-strava/oauth/strava/start", (c) => {
  const clientId = Deno.env.get("STRAVA_CLIENT_ID") || "";
  const appBase = Deno.env.get("APP_BASE_URL") || originFromRequest(c.req.raw);
  const redirectUri = `${appBase}/oauth/strava/callback`;
  const uid = c.req.query("uid");
  if (!uid) return c.text("Missing uid", 400);
  const state = signState(uid);
  const scope = "read,activity:read_all,profile:read_all";
  const url = `https://m.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  return c.redirect(url, 302);
});

app.get("/oauth/strava/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) return c.text("Missing code", 400);
  const uid = verifyState(state || "");
  if (!uid) return c.text("Invalid state", 400);
  const clientId = Deno.env.get("STRAVA_CLIENT_ID")!;
  const clientSecret = Deno.env.get("STRAVA_CLIENT_SECRET")!;
  const tokenResp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code" }),
  });
  if (!tokenResp.ok) return c.text("OAuth failed", 400);
  const tokenJson = await tokenResp.json();
  const access_token = tokenJson.access_token as string;
  const refresh_token = tokenJson.refresh_token as string;
  const expires_in = Number(tokenJson.expires_in || 0);
  const athlete = tokenJson.athlete || {};
  const provider_user_id = String(athlete.id || "");

  const sb = getServiceClient();
  const user_id = uid;

  await sb.from("providers").upsert({
    user_id,
    provider: "strava",
    access_token,
    refresh_token,
    expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
    provider_user_id,
  });

  // Trigger initial backfill
  await sb.from("webhook_logs").insert({ source: "strava", payload: { note: "oauth_completed", provider_user_id } });

  const bot = (Deno.env.get("PUBLIC_BOT_USERNAME") || "@the_bfit_bot").replace(/^@/, "");
  const html = `<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><title>BFIT – Connected</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;text-align:center}a.button{display:inline-block;margin-top:1rem;padding:.75rem 1rem;background:#111827;color:#fff;border-radius:10px;text-decoration:none}</style></head><body><h2>Strava connected ✅</h2><p>You can return to Telegram.</p><a class=\"button\" href=\"tg://resolve?domain=${bot}&start=connected\">Open Telegram</a><p><a href=\"https://t.me/${bot}?start=connected\">Open in Telegram (web link)</a></p><script>setTimeout(function(){location.href='tg://resolve?domain=${bot}&start=connected'},800);</script></body></html>`;
  return c.html(html);
});

function originFromRequest(req: Request): string {
  try {
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://TODO.functions.supabase.co"; // TODO
  }
}

function signState(uid: string): string {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "dev_secret";
  const ts = Date.now().toString();
  const base = `${uid}|${ts}`;
  const key = new TextEncoder().encode(secret);
  const data = new TextEncoder().encode(base);
  return base + "|" + toHex(sha256HmacSync(key, data));
}

function verifyState(state: string): string | null {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "dev_secret";
  const [uid, ts, sig] = state.split("|");
  if (!uid || !ts || !sig) return null;
  const base = `${uid}|${ts}`;
  const expected = toHex(sha256HmacSync(new TextEncoder().encode(secret), new TextEncoder().encode(base)));
  if (expected !== sig) return null;
  // optional: expiry 10 minutes
  const ageMs = Date.now() - Number(ts);
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) return null;
  return uid;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Minimal HMAC-SHA256 sync using WebCrypto (Deno supports subtle.digest but not HMAC sync);
// fallback to dumb XOR if not available (dev only). In Edge, use subtle.sign.
function sha256HmacSync(key: Uint8Array, data: Uint8Array): Uint8Array {
  // This is a simple placeholder to avoid async WebCrypto for brevity in MVP.
  // DO NOT use in production without replacing with crypto.subtle HMAC.
  let hash = new Uint8Array(32);
  for (let i = 0; i < data.length; i++) {
    hash[i % 32] ^= data[i] ^ key[i % key.length];
  }
  return hash;
}

export default {
  fetch: (req: Request) => app.fetch(req),
};


