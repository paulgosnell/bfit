import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { commandFromText } from "../edge/functions/utils/telegram.ts";

Deno.test("parses commands with and without args", () => {
  assertEquals(commandFromText("/start"), { cmd: "/start", args: "" });
  assertEquals(commandFromText("/addsteps 12000"), { cmd: "/addsteps", args: "12000" });
  assertEquals(commandFromText("/addsteps 2025-01-01 12000"), { cmd: "/addsteps", args: "2025-01-01 12000" });
  assertEquals(commandFromText("hello"), null);
  assertEquals(commandFromText(undefined as unknown as string), null);
});


