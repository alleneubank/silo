import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installJanitor, janitorBinary, janitorPlatform } from "./janitor";
import { JANITOR_VERSION } from "./janitor_release";

let base: string;
beforeAll(() => { base = mkdtempSync(path.join(os.tmpdir(), "silo-janitor-")); });
afterAll(() => { if (base) rmSync(base, { recursive: true }); });

const host = janitorPlatform(process.platform, process.arch);

test("each supported host maps to its Janitor release platform", () => {
  expect(janitorPlatform("darwin", "arm64")).toBe("macos-arm64");
  expect(janitorPlatform("darwin", "x64")).toBe("macos-x86_64");
  expect(janitorPlatform("linux", "arm64")).toBe("linux-aarch64");
  expect(janitorPlatform("linux", "x64")).toBe("linux-x86_64");
  expect(janitorPlatform("win32", "x64")).toBeNull();
  expect(janitorPlatform("linux", "riscv64")).toBeNull();
});

test("the bundled Janitor installs once per account home and runs", () => {
  if (host === null) throw new Error(`no bundled Janitor for ${process.platform}-${process.arch}`);
  const home = path.join(base, "home");
  const installed = installJanitor(host, home);
  expect(installed.startsWith(path.join(home, ".silo", "janitor", `${JANITOR_VERSION}-`))).toBe(true);
  expect(statSync(installed).mode & 0o111).not.toBe(0);
  const version = Bun.spawnSync([installed, "version"], { stdout: "pipe", stderr: "pipe", timeout: 5000 });
  expect({ exitCode: version.exitCode, stdout: version.stdout.toString() }).toMatchObject({ exitCode: 0, stdout: expect.stringContaining(JANITOR_VERSION) });
  const before = statSync(installed).mtimeMs;
  expect(installJanitor(host, home)).toBe(installed);
  expect(statSync(installed).mtimeMs).toBe(before);
  expect(readdirSync(path.dirname(installed))).toEqual(["janitor"]);
});

test("an embedded binary that does not match the pinned digest is refused and nothing is installed", () => {
  if (host === null) throw new Error(`no bundled Janitor for ${process.platform}-${process.arch}`);
  const home = path.join(base, "tampered");
  const asset = path.join(base, "not-janitor");
  writeFileSync(asset, "#!/bin/sh\nexit 0\n");
  expect(() => installJanitor(host, home, asset)).toThrow(expect.objectContaining({ code: "LAUNCH_FAILED", message: expect.stringContaining("SHA-256") }));
  expect(existsSync(path.join(home, ".silo", "janitor"))).toBe(false);
});

test("SILO_JANITOR replaces the bundled binary as given", () => {
  expect(janitorBinary({ SILO_JANITOR: "/opt/janitor-dev/janitor" })).toBe("/opt/janitor-dev/janitor");
});

test("a copy cut short is replaced by the full binary", () => {
  if (host === null) throw new Error(`no bundled Janitor for ${process.platform}-${process.arch}`);
  const home = path.join(base, "truncated");
  const installed = installJanitor(host, home);
  writeFileSync(installed, "");
  expect(installJanitor(host, home)).toBe(installed);
  expect(Bun.spawnSync([installed, "version"], { stdout: "pipe", timeout: 5000 }).exitCode).toBe(0);
});
