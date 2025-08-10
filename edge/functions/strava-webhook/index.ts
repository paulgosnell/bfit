import { Hono } from "npm:hono@4";
import { getServiceClient, insertPointsForActivity, flagOverlappingLongActivities } from "../utils/db.ts";

const app = new Hono();

// Support both root and explicit path for Strava subscription verify
app.get("/webhooks/strava", (c) => {
  const verifyToken = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN");
  if (verifyToken && challenge && expected && verifyToken === expected) {
    return c.json({ "hub.challenge": challenge });
  }
  return c.json({ ok: true }, 200);
});

app.get("/", (c) => {
  const verifyToken = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN");
  if (verifyToken && challenge && expected && verifyToken === expected) {
    return c.json({ "hub.challenge": challenge });
  }
  return c.json({ ok: true }, 200);
});

// Fallback for GET verification on any path
app.get("*", (c) => {
  const verifyToken = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = Deno.env.get("STRAVA_WEBHOOK_VERIFY_TOKEN");
  if (verifyToken && challenge && expected && verifyToken === expected) {
    return c.json({ "hub.challenge": challenge });
  }
  return c.json({ ok: true }, 200);
});

app.post("/webhooks/strava", async (c) => {
  const sb = getServiceClient();
  const payload = await c.req.json();
  // TODO: verify signature if provided by Strava headers
  await sb.from("webhook_logs").insert({ source: "strava", payload });

  try {
    if (payload.object_type === "activity" && (payload.aspect_type === "create" || payload.aspect_type === "update")) {
      const ownerId = String(payload.owner_id);
      const objectId = String(payload.object_id);
      // Find provider by provider_user_id (athlete id) - stored on OAuth callback
      const { data: prov, error: e1 } = await sb
        .from("providers")
        .select("id, user_id, access_token, refresh_token, expires_at, provider_user_id")
        .eq("provider", "strava")
        .eq("provider_user_id", ownerId)
        .maybeSingle();
      if (e1) throw e1;
      if (!prov) return c.json({ ok: true });

      let accessToken = prov.access_token as string;
      // refresh if expired
      if (prov.expires_at && new Date(prov.expires_at) < new Date()) {
        const refreshed = await refreshStravaToken(prov.refresh_token as string);
        if (refreshed) {
          accessToken = refreshed.access_token;
          await sb.from("providers").update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }).eq("id", prov.id);
        }
      }

      const act = await fetchStravaActivity(accessToken, objectId);
      if (act) {
        const activityRow = await upsertActivityFromStrava(sb, prov.user_id as string, act);
        await insertPointsForActivity(sb, activityRow.id, prov.user_id as string, (activityRow.type as any), activityRow);
        await flagOverlappingLongActivities(sb, prov.user_id as string, activityRow.start_time, activityRow.duration_seconds);
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ scope: "strava-webhook", ok: false, error: String(e?.message || e) }));
  }
  return c.json({ ok: true });
});

app.post("/", async (c) => {
  const sb = getServiceClient();
  const payload = await c.req.json();
  await sb.from("webhook_logs").insert({ source: "strava", payload });
  try {
    if (payload.object_type === "activity" && (payload.aspect_type === "create" || payload.aspect_type === "update")) {
      const ownerId = String(payload.owner_id);
      const objectId = String(payload.object_id);
      const { data: prov, error: e1 } = await sb
        .from("providers")
        .select("id, user_id, access_token, refresh_token, expires_at, provider_user_id")
        .eq("provider", "strava")
        .eq("provider_user_id", ownerId)
        .maybeSingle();
      if (e1) throw e1;
      if (!prov) return c.json({ ok: true });
      let accessToken = prov.access_token as string;
      if (prov.expires_at && new Date(prov.expires_at) < new Date()) {
        const refreshed = await refreshStravaToken(prov.refresh_token as string);
        if (refreshed) {
          accessToken = refreshed.access_token;
          await sb.from("providers").update({ access_token: refreshed.access_token, refresh_token: refreshed.refresh_token, expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString() }).eq("id", prov.id);
        }
      }
      const act = await fetchStravaActivity(accessToken, objectId);
      if (act) {
        const activityRow = await upsertActivityFromStrava(sb, prov.user_id as string, act);
        await insertPointsForActivity(sb, activityRow.id, prov.user_id as string, (activityRow.type as any), activityRow);
        await flagOverlappingLongActivities(sb, prov.user_id as string, activityRow.start_time, activityRow.duration_seconds);
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ scope: "strava-webhook", ok: false, error: String(e?.message || e) }));
  }
  return c.json({ ok: true });
});

// Fallback POST handler
app.post("*", async (c) => {
  const sb = getServiceClient();
  const payload = await c.req.json();
  await sb.from("webhook_logs").insert({ source: "strava", payload });
  return c.json({ ok: true });
});

async function refreshStravaToken(refresh_token: string): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("STRAVA_CLIENT_ID");
  const clientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const resp = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token }),
  });
  if (!resp.ok) return null;
  const json = await resp.json();
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in };
}

async function fetchStravaActivity(accessToken: string, activityId: string): Promise<any | null> {
  const resp = await fetch(`https://www.strava.com/api/v3/activities/${activityId}?include_all_efforts=false`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return null;
  return await resp.json();
}

async function upsertActivityFromStrava(sb: any, user_id: string, a: any) {
  const typeMap: Record<string, string> = { Run: "run", Ride: "ride", Swim: "swim" };
  const type = typeMap[a.type] || "run";
  const distance_meters = Math.round(Number(a.distance || 0));
  const duration_seconds = Math.round(Number(a.moving_time || a.elapsed_time || 0));
  const start_time = new Date(a.start_date || a.start_date_local || new Date()).toISOString();
  const raw = a;
  const { data, error } = await sb
    .from("activities")
    .upsert({ user_id, source: "strava", type, start_time, duration_seconds, distance_meters, raw }, { onConflict: "user_id,start_time,type" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export default {
  fetch: (req: Request) => app.fetch(req),
};


