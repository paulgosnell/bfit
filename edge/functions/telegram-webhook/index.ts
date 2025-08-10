import { Hono } from "npm:hono@4";
import { sendTelegramMessage, buildInlineKeyboard, commandFromText } from "../utils/telegram.ts";
import { getServiceClient, upsertUserByTelegram, ensureDefaultPublicLeague, joinLeague, leaveLeague, getLeaderboardForLeague, getWeeklyTotals, processedUpdateMark, getUserByTelegramId, createLeague, promoteMember } from "../utils/db.ts";

const app = new Hono();

// Health endpoints (support with and without function slug prefix)
app.get("/healthz", (c) => c.json({ ok: true }));
app.get("/telegram-webhook/healthz", (c) => c.json({ ok: true }));

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
        const edgeBase = Deno.env.get("EDGE_BASE_URL");
        const kb = buildInlineKeyboard([
          [
            { text: "Join Public League", callback_data: "join_public" },
            { text: "Connect Strava", url: `${edgeBase || (Deno.env.get("APP_BASE_URL") || "https://app.bfit.example")}/oauth/strava/start?uid=${user_id}` },
          ],
          [
            { text: "My Stats", callback_data: "stats" },
            { text: "Leaderboard", callback_data: "leaderboard" },
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
          text: "/start, /join, /leave, /stats, /leaderboard, /profile, /connect, /addsteps",
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
        await sendTelegramMessage(token, { chat_id: chatId, text: rows });
      } else if (cmd === "/profile") {
        const base = Deno.env.get("APP_BASE_URL") || "https://app.bfit.example"; // TODO
        await sendTelegramMessage(token, { chat_id: chatId, text: `Profile: ${base}/profile?uid=${user_id}` });
      } else if (cmd === "/connect") {
        const base = Deno.env.get("EDGE_BASE_URL") || Deno.env.get("APP_BASE_URL") || "https://app.bfit.example";
        await sendTelegramMessage(token, { chat_id: chatId, text: `Connect Strava: ${base}/oauth/strava/start?uid=${user_id}` });
      } else if (cmd === "/addsteps") {
        const parts = args.split(/\s+/).filter(Boolean);
        let dateISO = new Date().toISOString().slice(0, 10);
        let steps = 0;
        if (parts.length === 1) {
          steps = Number(parts[0]);
        } else if (parts.length >= 2) {
          dateISO = parts[0];
          steps = Number(parts[1]);
        }
        if (!Number.isFinite(steps) || steps <= 0) {
          await sendTelegramMessage(token, { chat_id: chatId, text: "Usage: /addsteps 12000 or /addsteps 2025-01-01 12000" });
        } else if (steps > 50_000) {
          await sendTelegramMessage(token, { chat_id: chatId, text: "Too many steps for a day." });
        } else {
          try {
            await (await import("../utils/db.ts")).addManualSteps(sb, user_id, dateISO, steps);
            await sendTelegramMessage(token, { chat_id: chatId, text: `Added ${steps} steps for ${dateISO}.` });
          } catch (e) {
            await sendTelegramMessage(token, { chat_id: chatId, text: `Could not add steps (${e.message}).` });
          }
        }
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
            await sendTelegramMessage(token, { chat_id: chatId, text: `Cannot promote (${e.message}).` });
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
      if (!chatId || !fromId) return c.json({ ok: true }, 200);
      const sbUser = await getUserByTelegramId(sb, fromId);
      if (!sbUser) return c.json({ ok: true }, 200);
      if (data === "join_public") {
        const league = await ensureDefaultPublicLeague(sb);
        await joinLeague(sb, league.id, sbUser.id, "member");
        await sendTelegramMessage(Deno.env.get("TELEGRAM_BOT_TOKEN")!, { chat_id: chatId, text: `Joined ${league.name}.` });
      } else if (data === "stats") {
        const stats = await getWeeklyTotals(sb, sbUser.id);
        await sendTelegramMessage(Deno.env.get("TELEGRAM_BOT_TOKEN")!, { chat_id: chatId, text: `Week: ${stats.total} pts` });
      } else if (data === "leaderboard") {
        const league = await ensureDefaultPublicLeague(sb);
        const lb = await getLeaderboardForLeague(sb, league.id);
        const rows = lb.rows.map((r: any, i: number) => `${i + 1}. ${r.user_id === sbUser.id ? "(you)" : r.user_id.slice(0, 6)} – ${r.points_total}`).join("\n") || "No entries yet";
        await sendTelegramMessage(Deno.env.get("TELEGRAM_BOT_TOKEN")!, { chat_id: chatId, text: rows });
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


