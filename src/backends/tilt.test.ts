import { describe, expect, test } from "bun:test";
import { buildSupervisedTiltArgv, buildTiltCiArgv } from "./tilt";

describe("buildSupervisedTiltArgv", () => {
  test("selects embedded production assets with exactly one explicit flag", () => {
    expect(buildSupervisedTiltArgv("prod")).toEqual([
      "janitor", "--grace-ms", "5000", "--", "tilt", "up", "--web-mode=prod",
    ]);
  });
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

describe("buildTiltCiArgv", () => {
  test("emits one production web-mode flag alongside CI arguments", () => {
    expect(buildTiltCiArgv({ webMode: "prod", timeout: "30s", extraArgs: ["--file", "OwnedTiltfile"] })).toEqual([
      "tilt", "ci", "--web-mode=prod", "--timeout", "30s", "--file", "OwnedTiltfile",
    ]);
  });

  test.each([{ args: ["--web-mode=dev"] }, { args: ["--web-mode", "dev"] }, { args: ["--web-mode=prod"] }])("refuses a conflicting passthrough %j", ({ args }) => {
    expect(() => buildTiltCiArgv({ webMode: "prod", timeout: undefined, extraArgs: args })).toThrow("conflicts");
  });

  test("retains passthrough and default behavior when no mode is selected", () => {
    expect(buildTiltCiArgv({ timeout: undefined, extraArgs: ["--web-mode=dev"] })).toEqual(["tilt", "ci", "--web-mode=dev"]);
  });
});
