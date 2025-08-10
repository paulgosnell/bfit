import { Hono } from "npm:hono@4";
import { sendTelegramMessage, buildInlineKeyboard, commandFromText, answerCallbackQuery } from "../utils/telegram.ts";
import { getServiceClient, upsertUserByTelegram, ensureDefaultPublicLeague, joinLeague, leaveLeague, getLeaderboardForLeague, getWeeklyTotals, processedUpdateMark, getUserByTelegramId, createLeague, promoteMember, getProviderForUser } from "../utils/db.ts";

const app = new Hono();

// Health endpoints (support with and without function slug prefix)

app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/telegram-webhook/healthz", (c) => c.json({ ok: true }));

// --- Read-only API for Mini-App (dashboard)
app.get("/api/me", async (c) => {
  try {
    const uidRaw = c.req.query("uid") || "";
    if (!uidRaw) return c.json({ connected: false, stats: {}, rival: null, username: null });
    const sb = getServiceClient();

    // Resolve user either by Telegram ID (number) or by internal UUID
    let userRow: any = null;
    const isNumeric = /^\d+$/.test(uidRaw);
    if (isNumeric) {
      userRow = await getUserByTelegramId(sb, Number(uidRaw));
    } else {
      const { data, error } = await sb.from("users").select("*").eq("id", uidRaw).maybeSingle();
      if (error) console.warn("api/me users fetch", error);
      userRow = data || null;
    }
    if (!userRow) return c.json({ connected: false, stats: {}, rival: null, username: null });

    // Connection status (Strava)
    const { data: prov, error: provErr } = await sb
      .from("providers")
      .select("provider, expires_at")
      .eq("user_id", userRow.id)
      .eq("provider", "strava")
      .maybeSingle();
    if (provErr) console.warn("api/me providers fetch", provErr);
    const connected = !!prov;

    // Weekly stats using existing util
    const totals = await getWeeklyTotals(sb, userRow.id);
    // Best-effort fields (fall back to 0/undefined if util doesn't provide)
    const stats = {
      points: Number(totals?.total ?? 0),
      steps: Number(totals?.steps ?? 0),
      distance: Number(totals?.distance_km ?? totals?.distance ?? 0) || 0,
      streak: Number(totals?.streak ?? 0) || 0,
    };

    // Rival nudge: use default public league and compute diff to person above
    const league = await ensureDefaultPublicLeague(sb);
    const lb = await getLeaderboardForLeague(sb, league.id);
    let rival: { name: string; diff: number } | null = null;
    if (Array.isArray(lb?.rows)) {
      const idx = lb.rows.findIndex((r: any) => r.user_id === userRow.id);
      if (idx > 0) {
        const me = lb.rows[idx];
        const above = lb.rows[idx - 1];
        const diff = Math.max(0, (above.points_total ?? 0) - (me.points_total ?? 0));
        if (diff > 0) {
          // Resolve display name
          let name = String(above.user_id).slice(0, 6);
          const { data: u2 } = await sb.from("users").select("username, first_name, last_name").eq("id", above.user_id).maybeSingle();
          if (u2) name = u2.username || u2.first_name || name;
          rival = { name, diff };
        }
      }
    }

    // Username for UI
    const username = userRow.username || userRow.first_name || null;
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ connected, stats, rival, username });
  } catch (e) {
    console.error("api/me error", e);
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ connected: false, stats: {}, rival: null, username: null });
  }
});

app.get("/api/leaderboard", async (c) => {
  try {
    const uidRaw = c.req.query("uid") || "";
    const sb = getServiceClient();
    const league = await ensureDefaultPublicLeague(sb);
    const lb = await getLeaderboardForLeague(sb, league.id);

    // Optional: mark "me" if uid provided
    let meId: string | null = null;
    if (/^\d+$/.test(uidRaw)) {
      const me = await getUserByTelegramId(sb, Number(uidRaw));
      meId = me?.id ?? null;
    } else if (uidRaw && uidRaw.includes("-")) {
      meId = uidRaw;
    }

    // Resolve names for top 10
    const rowsRaw = (lb?.rows || []).slice(0, 10);
    const ids = rowsRaw.map((r: any) => r.user_id);
    const { data: usersMapData } = ids.length
      ? await sb.from("users").select("id, username, first_name").in("id", ids)
      : { data: [] as any[] };
    const nameById = new Map<string, string>(
      (usersMapData || []).map((u: any) => [u.id, u.username || u.first_name || String(u.id).slice(0, 6)])
    );

    const rows = rowsRaw.map((r: any) => ({
      name: nameById.get(r.user_id) || String(r.user_id).slice(0, 6),
      points: Number(r.points_total ?? 0),
      me: meId ? r.user_id === meId : false,
    }));

    // ISO week number
    const weekNum = (() => {
      const d = new Date();
      const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - dayNum + 3);
      const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      const diff = (date.valueOf() - firstThursday.valueOf()) / 86400000;
      return 1 + Math.floor(diff / 7);
    })();

    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ week: weekNum, rows });
  } catch (e) {
    console.error("api/leaderboard error", e);
    c.header("Access-Control-Allow-Origin", "*");
    return c.json({ week: null, rows: [] });
  }
});

// Unified handler bound to multiple paths to cope with platform prefixing the function slug
const handleTelegram = async (c: any) => {
  const secret = c.req.param("secret");
  const expected = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!expected || secret !== expected) return c.json({ ok: true }, 200);

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")!; // TODO: set in env
  const body = await c.req.json();
  const sb = getServiceClient();

  try {
    const updateId = body.update_id as number | undefined;
    if (typeof updateId === "number") {
      const firstTime = await processedUpdateMark(sb, updateId);
      if (!firstTime) return c.json({ ok: true }, 200);
    }

    if (body.message) {
      const msg = body.message;
      const chatId = msg.chat.id as number;
      const from = msg.from ?? {};
      const telegram_id = from.id as number;
      const username = from.username as string | undefined;
      const first_name = from.first_name as string | undefined;
      const last_name = from.last_name as string | undefined;
      const { cmd, args } = commandFromText(msg.text) ?? { cmd: "", args: "" };

      const user = await upsertUserByTelegram(sb, { telegram_id, username, first_name, last_name });
      const { id: user_id } = user;

      if (cmd === "/start") {
        const appBase = Deno.env.get("APP_BASE_URL") || "https://bfitbot.netlify.app";
        const connectUrl = `${appBase}/oauth/strava/start?uid=${user_id}`;
        const kb = buildInlineKeyboard([
          [
            { text: "Join Public League", callback_data: "join_public" },
            { text: "Connect Strava", url: connectUrl },
          ],
          [
            { text: "My Stats", callback_data: "stats" },
            { text: "Leaderboard", callback_data: "leaderboard" },
          ],
          [
            { text: "Open BFIT", web_app: { url: `${appBase}/` } },
          ],
        ]);
        await sendTelegramMessage(token, {
          chat_id: chatId,
          text: "Welcome to BFIT. Compete weekly on steps & runs. Ready?",
          reply_markup: kb,
          disable_web_page_preview: true,
        });
      } else if (cmd === "/help") {
        await sendTelegramMessage(token, {
          chat_id: chatId,
          text: "/start, /join, /leave, /stats, /leaderboard, /profile, /connect",
        });
      } else if (cmd === "/join") {
        const league = await ensureDefaultPublicLeague(sb);
        await joinLeague(sb, league.id, user_id, "member");
        await sendTelegramMessage(token, { chat_id: chatId, text: `Joined ${league.name}. Good luck!` });
      } else if (cmd === "/leave") {
        const league = await ensureDefaultPublicLeague(sb);
        await leaveLeague(sb, league.id, user_id);
        await sendTelegramMessage(token, { chat_id: chatId, text: `Left ${league.name}.` });
      } else if (cmd === "/stats") {
        const stats = await getWeeklyTotals(sb, user_id);
        const last = (stats.recent || []).map((r) => `${r.type} ${(r.distance_meters ?? r.steps ?? 0)}`).join(" | ") || "–";
        await sendTelegramMessage(token, { chat_id: chatId, text: `Week: ${stats.total} pts | Recent: ${last}` });
      } else if (cmd === "/leaderboard") {
        const league = await ensureDefaultPublicLeague(sb);
        const lb = await getLeaderboardForLeague(sb, league.id);
        const rows = lb.rows.map((r: any, i: number) => `${i + 1}. ${r.user_id === user_id ? "(you)" : r.user_id.slice(0, 6)} – ${r.points_total}`).join("\n") || "No entries yet";
        const myIdx = lb.rows.findIndex((r: any) => r.user_id === user_id);
        let nudge = "";
        if (myIdx > 0) {
          const me = lb.rows[myIdx];
          const rival = lb.rows[myIdx - 1];
          const diff = Math.max(0, (rival.points_total ?? 0) - (me.points_total ?? 0));
          if (diff > 0) {
            const rivalName = rival.user_id === user_id ? "(you)" : String(rival.user_id).slice(0, 6);
            nudge = `\n\nOnly ${diff} pts to pass ${rivalName} — one good session will do it.`;
          }
        }
        const rowsWithNudge = rows + nudge;
        await sendTelegramMessage(token, { chat_id: chatId, text: rowsWithNudge });
      } else if (cmd === "/profile") {
        const base = Deno.env.get("APP_BASE_URL") || "https://bfitbot.netlify.app";
        const prov = await getProviderForUser(sb, user_id, "strava");
        const linked = prov ? "✅ Strava linked" : "❌ Strava not linked";
        await sendTelegramMessage(token, { chat_id: chatId, text: `${linked}. Profile: ${base}/profile?uid=${user_id}` });
      } else if (cmd === "/connect") {
        const appBase = Deno.env.get("APP_BASE_URL") || "https://bfitbot.netlify.app";
        const url = `${appBase}/oauth/strava/start?uid=${user_id}`;
        await sendTelegramMessage(token, { chat_id: chatId, text: `Connect Strava: ${url}` });
      } else if (cmd === "/newleague") {
        const name = args || "New League";
        const league = await createLeague(sb, user_id, name);
        await sendTelegramMessage(token, { chat_id: chatId, text: `Created league ${league.name}.` });
      } else if (cmd === "/promote") {
        const target = args.trim();
        if (!target) {
          await sendTelegramMessage(token, { chat_id: chatId, text: "Usage: /promote <user_id>" });
        } else {
          const league = await ensureDefaultPublicLeague(sb);
          try {
            await promoteMember(sb, league.id, user_id, target);
            await sendTelegramMessage(token, { chat_id: chatId, text: "Member promoted." });
          } catch (e) {
            const msg = String(e?.message || e);
            const hint = msg.toLowerCase().includes("forbidden") || msg.toLowerCase().includes("not admin")
              ? "Only league admins can use /promote."
              : "Unable to promote. Check the user ID and your permissions.";
            await sendTelegramMessage(token, { chat_id: chatId, text: hint });
          }
        }
      } else {
        // ignore
      }
    } else if (body.callback_query) {
      // Handle one-tap actions
      const q = body.callback_query;
      const data = String(q.data || "");
      const chatId = q.message?.chat?.id as number;
      const fromId = q.from?.id as number;
      const cbid = q.id as string;
      if (!chatId || !fromId) return c.json({ ok: true }, 200);
      const sbUser = await getUserByTelegramId(sb, fromId);
      if (!sbUser) return c.json({ ok: true }, 200);
      if (data === "join_public") {
        // Instant feedback to user; process join in background
        answerCallbackQuery(token, { callback_query_id: cbid, text: "Joining…", cache_time: 1 });
        const league = await ensureDefaultPublicLeague(sb);
        await joinLeague(sb, league.id, sbUser.id, "member");
        await sendTelegramMessage(token, { chat_id: chatId, text: `Joined ${league.name}.` });
      } else if (data === "stats") {
        answerCallbackQuery(token, { callback_query_id: cbid, cache_time: 1 });
        const stats = await getWeeklyTotals(sb, sbUser.id);
        await sendTelegramMessage(token, { chat_id: chatId, text: `Week: ${stats.total} pts` });
      } else if (data === "leaderboard") {
        answerCallbackQuery(token, { callback_query_id: cbid, cache_time: 1 });
        const league = await ensureDefaultPublicLeague(sb);
        const lb = await getLeaderboardForLeague(sb, league.id);
        const rows = lb.rows.map((r: any, i: number) => `${i + 1}. ${r.user_id === sbUser.id ? "(you)" : r.user_id.slice(0, 6)} – ${r.points_total}`).join("\n") || "No entries yet";
        const myIdx = lb.rows.findIndex((r: any) => r.user_id === sbUser.id);
        let nudge = "";
        if (myIdx > 0) {
          const me = lb.rows[myIdx];
          const rival = lb.rows[myIdx - 1];
          const diff = Math.max(0, (rival.points_total ?? 0) - (me.points_total ?? 0));
          if (diff > 0) {
            const rivalName = rival.user_id === sbUser.id ? "(you)" : String(rival.user_id).slice(0, 6);
            nudge = `\n\nOnly ${diff} pts to pass ${rivalName} — one good session will do it.`;
          }
        }
        const rowsWithNudge = rows + nudge;
        await sendTelegramMessage(token, { chat_id: chatId, text: rowsWithNudge });
      }
    }

    return c.json({ ok: true });
  } catch (e) {
    console.error(JSON.stringify({ scope: "telegram", ok: false, error: String(e?.message || e) }));
    return c.json({ ok: true }); // Telegram should not retry storm
  }
  return c.json({ ok: true });
};

app.post("/telegram/webhook/:secret", handleTelegram);
app.post("/telegram-webhook/telegram/webhook/:secret", handleTelegram);

export default {
  fetch: (req: Request) => app.fetch(req),
};
