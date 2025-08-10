import { Hono } from "npm:hono@4";
import { getServiceClient } from "../utils/db.ts";
import { sendTelegramMessage } from "../utils/telegram.ts";

const app = new Hono();

// Support both /oauth/strava/start and /oauth-strava/oauth/strava/start
app.get("/oauth/strava/start", async (c) => {
  const clientId = Deno.env.get("STRAVA_CLIENT_ID") || ""; // TODO
  const edgeBase = Deno.env.get("EDGE_BASE_URL") || originFromRequest(c.req.raw);
  const redirectUri = `${edgeBase}/oauth/strava/callback`;
  const uid = c.req.query("uid");
  if (!uid) return c.text("Missing uid", 400);
  const state = await signState(uid);
  const scope = "read,activity:read_all,profile:read_all";
  const url = `https://m.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  return c.redirect(url, 302);
});

app.get("/oauth-strava/oauth/strava/start", async (c) => {
  const clientId = Deno.env.get("STRAVA_CLIENT_ID") || "";
  const edgeBase = Deno.env.get("EDGE_BASE_URL") || originFromRequest(c.req.raw);
  const redirectUri = `${edgeBase}/oauth/strava/callback`;
  const uid = c.req.query("uid");
  if (!uid) return c.text("Missing uid", 400);
  const state = await signState(uid);
  const scope = "read,activity:read_all,profile:read_all";
  const url = `https://m.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=auto&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}`;
  return c.redirect(url, 302);
});

app.get("/oauth/strava/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) return c.text("Missing code", 400);
  const uid = await verifyState(state || "");
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

  // Nudge user back in Telegram chat
  try {
    const { data: userRow } = await sb.from("users").select("telegram_id").eq("id", user_id).single();
    const tgId = userRow?.telegram_id as number | undefined;
    const tgToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (tgId && tgToken) {
      await sendTelegramMessage(tgToken, { chat_id: tgId, text: "Strava connected ✅. You’re all set. Try /stats or /leaderboard." });
    }
  } catch (_) {
    // ignore
  }

  const bot = (Deno.env.get("PUBLIC_BOT_USERNAME") || "@the_bfit_bot").replace(/^@/, "");
  const html = `<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><title>BFIT – Connected</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;text-align:center}a.button{display:inline-block;margin-top:1rem;padding:.75rem 1rem;background:#111827;color:#fff;border-radius:10px;text-decoration:none}</style></head><body><h2>Strava connected ✅</h2><p>You can return to Telegram.</p><a class=\"button\" href=\"tg://resolve?domain=${bot}&start=connected\">Open Telegram</a><p><a href=\"https://t.me/${bot}?start=connected\">Open in Telegram (web link)</a></p><script>try { Telegram.WebApp.close(); } catch(e) {} setTimeout(function(){location.href='tg://resolve?domain=${bot}&start=connected'},800);</script></body></html>`;
  return c.html(html);
});

// Also handle slug-prefixed callback when routed via proxy
app.get("/oauth-strava/oauth/strava/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) return c.text("Missing code", 400);
  const uid = await verifyState(state || "");
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

  await sb.from("webhook_logs").insert({ source: "strava", payload: { note: "oauth_completed", provider_user_id } });

  const bot = (Deno.env.get("PUBLIC_BOT_USERNAME") || "@the_bfit_bot").replace(/^@/, "");
  const html = `<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><title>BFIT – Connected</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:2rem;text-align:center}a.button{display:inline-block;margin-top:1rem;padding:.75rem 1rem;background:#111827;color:#fff;border-radius:10px;text-decoration:none}</style></head><body><h2>Strava connected ✅</h2><p>You can return to Telegram.</p><a class=\"button\" href=\"tg://resolve?domain=${bot}&start=connected\">Open Telegram</a><p><a href=\"https://t.me/${bot}?start=connected\">Open in Telegram (web link)</a></p><script>try { Telegram.WebApp.close(); } catch(e) {} setTimeout(function(){location.href='tg://resolve?domain=${bot}&start=connected'},800);</script></body></html>`;
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

async function signState(uid: string): Promise<string> {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "dev_secret";
  const ts = Date.now().toString();
  const base = `${uid}|${ts}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(base));
  return base + "|" + toHex(new Uint8Array(signature));
}

async function verifyState(state: string): Promise<string | null> {
  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "dev_secret";
  const parts = state.split("|");
  if (parts.length !== 3) return null;
  const [uid, ts, sig] = parts;
  if (!uid || !ts || !sig) return null;
  const base = `${uid}|${ts}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const sigBytes = hexToBytes(sig);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(base));
  if (!valid) return null;
  // optional: expiry 10 minutes
  const ageMs = Date.now() - Number(ts);
  if (!Number.isFinite(ageMs) || ageMs > 10 * 60 * 1000) return null;
  return uid;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export default {
  fetch: (req: Request) => app.fetch(req),
};
