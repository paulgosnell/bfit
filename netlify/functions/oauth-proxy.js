// Netlify Function: Proxy OAuth (Strava) to Supabase Edge Function, adding Authorization header
exports.handler = async (event) => {
  const supabaseProjectRef = "ibginimdnezoftxxygvt";
  const base = `https://${supabaseProjectRef}.functions.supabase.co/oauth-strava`;
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  const path = event.path.replace("/.netlify/functions/oauth-proxy", "");
  const targetUrl = `${base}${path || "/"}${event.rawQuery ? `?${event.rawQuery}` : ""}`;

  const headers = { "content-type": event.headers["content-type"] || "application/json" };
  if (anonKey) headers["authorization"] = `Bearer ${anonKey}`;

  const init = {
    method: event.httpMethod,
    headers,
    body: ["GET", "HEAD"].includes(event.httpMethod) ? undefined : event.body,
  };

  try {
    const resp = await fetch(targetUrl, init);
    const text = await resp.text();
    // Preserve redirects from Supabase (Strava authorize 302)
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      return { statusCode: resp.status, headers: { Location: resp.headers.get("location") }, body: "" };
    }
    return { statusCode: resp.status, headers: { "content-type": resp.headers.get("content-type") || "text/plain" }, body: text };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e.message) }) };
  }
};


