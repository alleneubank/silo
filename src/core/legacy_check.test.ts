import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findLegacyState } from "./legacy_check";
import { ProjectOperation } from "./lease_store";

let base: string;
let root: string;
let inputs: { accountHome: string; home: string; registryDir: string };

beforeEach(() => {
  base = mkdtempSync(path.join(os.tmpdir(), "silo-legacy-"));
  root = path.join(base, "unrelated-b"); mkdirSync(root);
  inputs = { accountHome: path.join(base, "account"), home: path.join(base, "scrubbed-home"), registryDir: path.join(base, "override") };
});
afterEach(() => rmSync(base, { recursive: true }));

describe("host-wide read-only legacy refusal", () => {
  test.each(["account", "home", "override"])("a lock-only peer entry in %s blocks an unrelated allocator before store creation", async location => {
    const dir = location === "account" ? path.join(inputs.accountHome, ".silo", "instances") : location === "home" ? path.join(inputs.home, ".silo", "instances") : inputs.registryDir;
    mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, "peer-a.json");
    const contents = JSON.stringify({ projectRoot: path.join(base, "a"), ports: [3000], tiltPid: 71234 });
    writeFileSync(entry, contents);
    const storePath = path.join(base, "new-store", "leases.sqlite");
    const before = readdirSync(base, { recursive: true });
    const found = await findLegacyState(root, inputs);
    expect(found).toEqual([{ kind: "registry", path: entry, root: path.join(base, "a"), ports: [3000], recordedPids: [71234] }]);
    await expect(ProjectOperation.open(root, { storePath, legacyInputs: inputs })).rejects.toThrow("LEGACY_STATE");
    expect(existsSync(path.dirname(storePath))).toBe(false);
    expect(readFileSync(entry, "utf8")).toBe(contents);
    expect(readdirSync(base, { recursive: true })).toEqual(before);
  });

  test.each(["{ malformed", "null", "[1, 2]"])("unparseable registry data %s remains a blocking listing", async content => {
    mkdirSync(inputs.registryDir);
    const entry = path.join(inputs.registryDir, "crashed.json"); writeFileSync(entry, content);
    expect(await findLegacyState(root, inputs)).toEqual([{ kind: "registry", path: entry, unrecognized: true }]);
    expect(readFileSync(entry, "utf8")).toBe(content);
  });

  test.each(["{ truncated", '{"version":1,"instance":{"name":"old"}}']) ("pre-registry root lock %s blocks without any registry entry", async content => {
    const file = path.join(root, ".silo.lock"); writeFileSync(file, content);
    expect(await findLegacyState(root, inputs)).toEqual([{ kind: "lock", path: file, root, unrecognized: true }]);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  test("a store-marked snapshot is not a legacy lock, and duplicate registry locations list once", async () => {
    writeFileSync(path.join(root, ".silo.lock"), JSON.stringify({ version: 2, projectId: "new-project", generation: 1 }));
    expect(await findLegacyState(root, inputs)).toEqual([]);
    const dir = path.join(inputs.accountHome, ".silo", "instances"); mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "peer.json"), "malformed");
    const found = await findLegacyState(root, { accountHome: inputs.accountHome, home: inputs.accountHome, registryDir: dir });
    expect(found).toHaveLength(1);
  });

  test("a failed directory query refuses instead of proving the account clean", async () => {
    writeFileSync(inputs.registryDir, "not a directory");
    await expect(findLegacyState(root, inputs)).rejects.toThrow("Cannot inspect legacy state");
    expect(readFileSync(inputs.registryDir, "utf8")).toBe("not a directory");
  });
});
