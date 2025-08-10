import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { calcPoints } from "../edge/functions/utils/points.ts";

Deno.test("steps points calculation", () => {
  const a0 = calcPoints({ source: "manual", type: "steps", start_time: new Date().toISOString(), steps: 0 });
  assertEquals(a0.points, 0);

  const a1 = calcPoints({ source: "manual", type: "steps", start_time: new Date().toISOString(), steps: 1000 });
  assertEquals(a1.points, 1);

  const a2 = calcPoints({ source: "manual", type: "steps", start_time: new Date().toISOString(), steps: 10500 });
  assertEquals(a2.points, 10);
});

Deno.test("run points with bonus and clamp", () => {
  const r1 = calcPoints({ source: "strava", type: "run", start_time: new Date().toISOString(), distance_meters: 4900 });
  assertEquals(r1.points, 4);

  const r2 = calcPoints({ source: "strava", type: "run", start_time: new Date().toISOString(), distance_meters: 5200 });
  assertEquals(r2.points, 10);

  const r3 = calcPoints({ source: "strava", type: "run", start_time: new Date().toISOString(), distance_meters: 150_000 });
  // 100km + 5 bonus
  assertEquals(r3.points, 105);
});

Deno.test("ride and swim points with clamp and flags", () => {
  const ride = calcPoints({ source: "strava", type: "ride", start_time: new Date().toISOString(), distance_meters: 20_000 });
  assertEquals(ride.points, 10);

  const rideReduced = calcPoints({ source: "strava", type: "ride", start_time: new Date().toISOString(), distance_meters: 20_000, raw: { commute: true } });
  assertEquals(rideReduced.points, 5);

  const rideClamp = calcPoints({ source: "strava", type: "ride", start_time: new Date().toISOString(), distance_meters: 400_000 });
  assertEquals(rideClamp.points, 150);

  const swimClamp = calcPoints({ source: "strava", type: "swim", start_time: new Date().toISOString(), distance_meters: 30_000 });
  assertEquals(swimClamp.points, 60);
});


