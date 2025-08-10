import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { calcPoints, getWeekStartDateISO, ActivityType } from "./points.ts";

// Minimal server-side client using service role in Edge Function
export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function upsertUserByTelegram(sb: SupabaseClient, tg: {
  telegram_id: number;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  const { data, error } = await sb
    .from("users")
    .upsert({
      telegram_id: tg.telegram_id,
      username: tg.username ?? null,
      first_name: tg.first_name ?? null,
      last_name: tg.last_name ?? null,
    }, { onConflict: "telegram_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function ensureDefaultPublicLeague(sb: SupabaseClient) {
  const { data, error } = await sb
    .from("leagues")
    .select("*")
    .eq("is_public", true)
    .ilike("name", "BFIT Public League")
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: e2 } = await sb
    .from("leagues")
    .insert({ name: "BFIT Public League", description: "Everyone welcome", is_public: true })
    .select("*")
    .single();
  if (e2) throw e2;
  return created;
}

export async function joinLeague(sb: SupabaseClient, league_id: string, user_id: string, role: "member" | "admin" = "member") {
  const { error } = await sb
    .from("league_members")
    .upsert({ league_id, user_id, role }, { onConflict: "league_id,user_id" });
  if (error) throw error;
}

export async function leaveLeague(sb: SupabaseClient, league_id: string, user_id: string) {
  const { error } = await sb
    .from("league_members")
    .delete()
    .match({ league_id, user_id });
  if (error) throw error;
}

export async function isLeagueAdmin(sb: SupabaseClient, league_id: string, user_id: string): Promise<boolean> {
  const { data, error } = await sb
    .from("league_members")
    .select("role")
    .match({ league_id, user_id })
    .maybeSingle();
  if (error) throw error;
  return data?.role === "admin";
}

export async function createLeague(sb: SupabaseClient, creator_id: string, name: string, description?: string | null) {
  const { data: league, error } = await sb
    .from("leagues")
    .insert({ name, description: description ?? null, created_by: creator_id })
    .select("*")
    .single();
  if (error) throw error;
  await joinLeague(sb, league.id, creator_id, "admin");
  return league;
}

export async function promoteMember(sb: SupabaseClient, league_id: string, requester_id: string, target_user_id: string) {
  const isAdmin = await isLeagueAdmin(sb, league_id, requester_id);
  if (!isAdmin) throw new Error("Not a league admin");
  const { error } = await sb
    .from("league_members")
    .upsert({ league_id, user_id: target_user_id, role: "admin" }, { onConflict: "league_id,user_id" });
  if (error) throw error;
}

export async function addManualSteps(sb: SupabaseClient, user_id: string, dateISO: string, steps: number) {
  // anti-cheat: manual steps must be <= 50k/day
  if (steps > 50_000) throw new Error("Too many steps for manual entry");
  const start = new Date(dateISO);
  const { data: act, error } = await sb
    .from("activities")
    .insert({ user_id, source: "manual", type: "steps", start_time: start.toISOString(), steps })
    .select("*")
    .single();
  if (error) throw error;
  await insertPointsForActivity(sb, act.id, user_id, "steps", act);
  return act;
}

export async function insertPointsForActivity(
  sb: SupabaseClient,
  activity_id: string,
  user_id: string,
  activityType: ActivityType,
  activityRow: { distance_meters?: number | null; steps?: number | null; start_time: string; raw?: unknown },
) {
  const { points, reason } = calcPoints({
    source: "strava",
    type: activityType,
    distance_meters: activityRow.distance_meters ?? null,
    steps: activityRow.steps ?? null,
    start_time: activityRow.start_time,
    raw: activityRow.raw ?? null,
  });
  const week_start_date = getWeekStartDateISO(new Date(activityRow.start_time));
  const { error } = await sb
    .from("points")
    .insert({ activity_id, user_id, week_start_date, points });
  if (error) throw error;
  return { points, reason };
}

export async function getWeeklyTotals(sb: SupabaseClient, user_id: string) {
  const week_start_date = getWeekStartDateISO(new Date());
  const { data: totals, error } = await sb
    .from("points")
    .select("points")
    .eq("user_id", user_id)
    .eq("week_start_date", week_start_date);
  if (error) throw error;
  const total = (totals ?? []).reduce((a, r) => a + (r.points as number), 0);

  const { data: recent, error: e2 } = await sb
    .from("activities")
    .select("id, type, start_time, distance_meters, steps")
    .eq("user_id", user_id)
    .order("start_time", { ascending: false })
    .limit(3);
  if (e2) throw e2;

  return { week_start_date, total, recent: recent ?? [] };
}

export async function getUserByTelegramId(sb: SupabaseClient, telegram_id: number) {
  const { data, error } = await sb.from("users").select("*").eq("telegram_id", telegram_id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getLeaderboardForLeague(sb: SupabaseClient, league_id: string) {
  const week_start_date = getWeekStartDateISO(new Date());
  const { data, error } = await sb
    .from("weekly_leaderboard_view")
    .select("user_id, league_id, week_start_date, points_total")
    .match({ league_id, week_start_date })
    .order("points_total", { ascending: false })
    .limit(10);
  if (error) throw error;
  return { week_start_date, rows: data ?? [] };
}

export async function processedUpdateMark(sb: SupabaseClient, update_id: number): Promise<boolean> {
  const { error } = await sb.from("processed_updates").insert({ update_id });
  if (!error) return true;
  // constraint violation means already processed
  if (String(error.message).toLowerCase().includes("duplicate")) return false;
  // On Supabase, use code "23505" for unique_violation
  if ((error as any).code === "23505") return false;
  throw error;
}

export async function logSuspect(sb: SupabaseClient, note: string, extra: unknown) {
  await sb.from("webhook_logs").insert({ source: "strava", payload: { suspect: true, note, extra } });
}

export async function flagOverlappingLongActivities(sb: SupabaseClient, user_id: string, startISO: string, duration_seconds?: number | null): Promise<boolean> {
  const dur = Number(duration_seconds || 0);
  if (dur <= 0) return;
  if (dur < 60 * 60) return; // only long activities >= 1h
  const start = new Date(startISO);
  const end = new Date(start.getTime() + dur * 1000);
  const { data, error } = await sb
    .from("activities")
    .select("id, start_time, duration_seconds")
    .eq("user_id", user_id)
    .gte("start_time", new Date(start.getTime() - 6 * 60 * 60 * 1000).toISOString())
    .lte("start_time", new Date(end.getTime() + 6 * 60 * 60 * 1000).toISOString());
  if (error) throw error;
  const overlaps = (data || []).filter((a) => a.start_time !== startISO);
  if (overlaps.length > 0) {
    await logSuspect(sb, "overlapping_long_activities", { user_id, startISO, duration_seconds, overlaps });
    return true;
  }
  return false;
}


