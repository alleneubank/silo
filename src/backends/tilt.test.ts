import { describe, expect, test } from "bun:test";
import { buildSupervisedTiltArgv } from "./tilt";

describe("buildSupervisedTiltArgv", () => {
  test("runs tilt up under a supervisor rather than directly", () => {
    const argv = buildSupervisedTiltArgv();
    expect(argv[0]).toBe("janitor");
    expect(argv.slice(-2)).toEqual(["tilt", "up"]);
  });

  test("separates supervisor flags from the supervised command", () => {
    const argv = buildSupervisedTiltArgv();
    const separator = argv.indexOf("--");
    expect(separator).toBeGreaterThan(0);
    expect(argv.slice(separator + 1)).toEqual(["tilt", "up"]);
  });

  test("allows a grace window so Tilt can release ports before SIGKILL", () => {
    const argv = buildSupervisedTiltArgv();
    const flag = argv.indexOf("--grace-ms");
    expect(flag).toBeGreaterThan(0);
    expect(Number(argv[flag + 1])).toBeGreaterThan(0);
    // Must precede `--`, otherwise janitor forwards it to tilt instead.
    expect(flag).toBeLessThan(argv.indexOf("--"));
  });
});
