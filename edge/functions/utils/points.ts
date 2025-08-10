// Points calculation utilities for BFIT
// Runtime: Deno (Supabase Edge)

export type ActivitySource = "strava" | "manual";
export type ActivityType = "steps" | "run" | "ride" | "swim";

export interface ActivityInput {
  source: ActivitySource;
  type: ActivityType;
  start_time: string; // ISO timestamp
  duration_seconds?: number | null;
  distance_meters?: number | null;
  steps?: number | null;
  raw?: unknown;
}

export interface CalcPointsResult {
  points: number;
  reason: string;
}

export function toKilometers(distanceMeters: number | null | undefined): number {
  if (!distanceMeters || distanceMeters <= 0) return 0;
  return distanceMeters / 1000;
}

export function clampDistanceKm(activityType: ActivityType, km: number): number {
  if (km <= 0) return 0;
  switch (activityType) {
    case "run":
      return Math.min(km, 100);
    case "ride":
      return Math.min(km, 300);
    case "swim":
      return Math.min(km, 20);
    default:
      return km;
  }
}

export function clampSteps(steps: number): number {
  if (steps <= 0) return 0;
  return Math.min(steps, 100_000);
}

export function weekStartMonday(date: Date): Date {
  // Convert to Monday 00:00 of the same ISO week
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day); // Sunday (0) -> -6 days, else (1..6)
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function calcPoints(activity: ActivityInput): CalcPointsResult {
  const type = activity.type;
  const raw = (activity.raw ?? {}) as Record<string, unknown>;

  if (type === "steps") {
    const steps = clampSteps(Number(activity.steps ?? 0));
    const points = Math.floor(steps / 1000);
    return { points, reason: `steps ${steps}` };
  }

  const km = clampDistanceKm(type, toKilometers(activity.distance_meters ?? 0));

  let basePoints = 0;
  let reason = `${type} ${km.toFixed(2)}km`;

  if (type === "run") {
    basePoints = Math.floor(km);
    if (km >= 5) {
      basePoints += 5;
      reason += " +bonus5";
    }
  } else if (type === "ride") {
    basePoints = Math.floor(km * 0.5);
  } else if (type === "swim") {
    basePoints = Math.floor(km * 3);
  } else {
    basePoints = 0;
  }

  // Strava flags: if trainer or commute for ride, reduce by 50%
  if (type === "ride") {
    const isTrainer = Boolean((raw as any)?.trainer || (raw as any)?.from_trainer);
    const isCommute = Boolean((raw as any)?.commute);
    if (isTrainer || isCommute) {
      basePoints = Math.floor(basePoints * 0.5);
      reason += " (reduced)";
    }
  }

  return { points: Math.max(0, basePoints), reason };
}

export function getWeekStartDateISO(date: Date): string {
  return weekStartMonday(date).toISOString().slice(0, 10);
}


