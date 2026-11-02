import { describe, expect, test } from "bun:test";
import { resolveHosts } from "./hosts";
import { buildIdentityVars } from "./identity";

describe("resolveHosts", () => {
  test("preserves an explicit Tilt host independently of the app host", () => {
    const result = resolveHosts({
      templates: { APP_HOST: "${name}.localhost", TILT_HOST: "127.0.0.1" },
      order: ["APP_HOST", "TILT_HOST"],
      identityVars: buildIdentityVars("demo", "localnet"),
    });
    expect(result.hosts).toEqual({ APP_HOST: "demo.localhost", TILT_HOST: "127.0.0.1" });
    expect(result.order).toEqual(["APP_HOST", "TILT_HOST"]);
  });

  test("uses the app host only when Tilt host is absent", () => {
    const result = resolveHosts({
      templates: { APP_HOST: "${name}.localhost" },
      order: ["APP_HOST"],
      identityVars: buildIdentityVars("demo", "localnet"),
    });
    expect(result.hosts.TILT_HOST).toBe("demo.localhost");
    expect(result.order).toEqual(["APP_HOST", "TILT_HOST"]);
  });

  test("does not replace an explicitly empty Tilt host with the app hostname", () => {
    const result = resolveHosts({
      templates: { APP_HOST: "demo.localhost", TILT_HOST: "" },
      order: ["APP_HOST", "TILT_HOST"],
      identityVars: buildIdentityVars("demo", "localnet"),
    });
    expect(result.hosts.TILT_HOST).toBe("");
  });
});
