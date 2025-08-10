// Netlify Function: Proxy Telegram webhook to Supabase Edge Function, adding Authorization header
exports.handler = async (event) => {
  const supabaseProjectRef = "ibginimdnezoftxxygvt";
  const base = `https://${supabaseProjectRef}.functions.supabase.co/telegram-webhook`;
  const anonKey = process.env.SUPABASE_ANON_KEY || "";
  const path = event.path.replace("/.netlify/functions/telegram-proxy", "");
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
    return { statusCode: resp.status, headers: { "content-type": resp.headers.get("content-type") || "application/json" }, body: text };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(e.message) }) };
  }
};


