import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveGithubEnvPath, shouldExportCiEnv, withCiEnv } from "./ci";

describe("shouldExportCiEnv", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = { CI: process.env.CI, GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  test("is on when the flag was passed", () => {
    expect(shouldExportCiEnv(true)).toBe(true);
  });

  test("is off outside CI without the flag", () => {
    expect(shouldExportCiEnv(false)).toBe(false);
  });

  test("infers CI from the environment", () => {
    process.env.CI = "true";
    expect(shouldExportCiEnv(false)).toBe(true);
  });

  // A shell that exports CI=false is stating it is not CI.
  test("does not infer CI from falsy values", () => {
    process.env.CI = "false";
    expect(shouldExportCiEnv(false)).toBe(false);
    process.env.CI = "0";
    expect(shouldExportCiEnv(false)).toBe(false);
    process.env.CI = "";
    expect(shouldExportCiEnv(false)).toBe(false);
  });

  test("infers CI from GITHUB_ACTIONS", () => {
    process.env.GITHUB_ACTIONS = "true";
    expect(shouldExportCiEnv(false)).toBe(true);
  });
});

describe("withCiEnv", () => {
  // Tiltfiles gate e2e resources on `os.environ.get("CI") == "true"`. Running
  // them is the entire point of `silo ci`, so the command states it is CI
  // rather than depending on the caller to have exported it.
  test("marks the environment as CI", () => {
    expect(withCiEnv({ API_PORT: "8080" })).toEqual({ API_PORT: "8080", CI: "true" });
  });

  test("overrides an inherited CI value", () => {
    expect(withCiEnv({ CI: "false" }).CI).toBe("true");
  });

  test("does not mutate the caller's env", () => {
    const env = { API_PORT: "8080" };
    withCiEnv(env);
    expect(env).toEqual({ API_PORT: "8080" });
  });
});

describe("resolveGithubEnvPath", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.GITHUB_ENV;
    delete process.env.GITHUB_ENV;
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env.GITHUB_ENV;
    } else {
      process.env.GITHUB_ENV = saved;
    }
  });

  test("returns the path when set", () => {
    process.env.GITHUB_ENV = "/tmp/github.env";
    expect(resolveGithubEnvPath(false)).toBe("/tmp/github.env");
  });

  // CI=true alone does not promise a GITHUB_ENV file: that pairing only holds
  // on GitHub Actions. Running locally with CI=true must not be fatal.
  test("returns null when unset and export was only inferred", () => {
    expect(resolveGithubEnvPath(false)).toBeNull();
  });

  test("treats a blank path as unset", () => {
    process.env.GITHUB_ENV = "   ";
    expect(resolveGithubEnvPath(false)).toBeNull();
  });

  // Asking for the export explicitly and having nowhere to write it is an
  // error: silently skipping would drop vars the caller said they need.
  test("throws when unset and export was requested explicitly", () => {
    expect(() => resolveGithubEnvPath(true)).toThrow(
      "GITHUB_ENV is not set; cannot export env vars for CI"
    );
  });
});
