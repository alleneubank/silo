import { describe, expect, test } from "bun:test";
import { isTrackedTiltCommand } from "./process";

describe("isTrackedTiltCommand", () => {
  test("accepts tilt itself", () => {
    expect(isTrackedTiltCommand("tilt")).toBe(true);
  });

  // silo records the pid it spawned, which is the supervisor wrapping tilt.
  // Without this, `silo status` reports stopped and `silo down` skips teardown.
  test("accepts the supervisor that owns tilt", () => {
    expect(isTrackedTiltCommand("janitor")).toBe(true);
  });

  test("rejects an unrelated process that reused the pid", () => {
    expect(isTrackedTiltCommand("bash")).toBe(false);
    expect(isTrackedTiltCommand("postgres")).toBe(false);
    expect(isTrackedTiltCommand("")).toBe(false);
  });
});
