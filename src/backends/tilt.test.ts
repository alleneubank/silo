import { describe, expect, test } from "bun:test";
import { buildTiltCiArgv } from "./tilt";

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
