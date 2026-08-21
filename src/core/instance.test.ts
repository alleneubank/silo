import { describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { loadConfig } from "./config";
import { buildInstanceState } from "./instance";
import type { Lockfile } from "./types";

const withConfig = async (
  run: (configPath: string) => Promise<void>
): Promise<void> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-instance-"));
  try {
    const configPath = path.join(dir, "silo.toml");
    await fs.writeFile(configPath, 'version = 1\n\n[ports]\nAPI_PORT = "random"\n');
    await run(configPath);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

const lockfileWith = (disowned: Lockfile["instance"]["disownedTilts"]): Lockfile => ({
  version: 1,
  generatedAt: "2026-08-21T00:00:00.000Z",
  instance: {
    name: "pinned",
    ports: { API_PORT: 51000 },
    identity: {
      name: "pinned",
      prefix: "silo",
      composeName: "silo-pinned",
      dockerNetwork: "silo-pinned",
      volumePrefix: "silo-pinned",
      containerPrefix: "silo-pinned-",
      hosts: {},
    },
    createdAt: "2026-08-21T00:00:00.000Z",
    k3dClusterCreated: false,
    ...(disowned ? { disownedTilts: disowned } : {}),
  },
});

describe("buildInstanceState", () => {
  // A rebuilt state overwrites the lockfile. Losing the disowned list here is
  // what leaves a running Tilt with no record anywhere.
  test("carries stacks disowned by an earlier --force", async () => {
    await withConfig(async (configPath) => {
      const config = await loadConfig(configPath);
      const disowned = [
        {
          pid: 71251,
          name: "pinned",
          ports: { API_PORT: 51000 },
          disownedAt: "2026-08-21T02:00:00.000Z",
        },
      ];

      const { state } = await buildInstanceState({
        config,
        name: "pinned",
        profile: undefined,
        lockfile: lockfileWith(disowned),
        force: false,
      });

      expect(state.disownedTilts).toEqual(disowned);
    });
  });

  // `up` probes liveness before rebuilding, so the list it passes is the
  // authoritative one: dead stacks are dropped rather than carried forward.
  test("prefers an explicitly supplied disowned list over the lockfile's", async () => {
    await withConfig(async (configPath) => {
      const config = await loadConfig(configPath);
      const stale = [
        {
          pid: 111,
          name: "pinned",
          ports: { API_PORT: 51000 },
          disownedAt: "2026-08-20T00:00:00.000Z",
        },
      ];

      const { state } = await buildInstanceState({
        config,
        name: "pinned",
        profile: undefined,
        lockfile: lockfileWith(stale),
        force: false,
        disownedTilts: [],
      });

      expect(state.disownedTilts).toBeUndefined();
    });
  });

  test("omits the disowned list when nothing was disowned", async () => {
    await withConfig(async (configPath) => {
      const config = await loadConfig(configPath);

      const { state } = await buildInstanceState({
        config,
        name: "pinned",
        profile: undefined,
        lockfile: lockfileWith(undefined),
        force: false,
      });

      expect(state.disownedTilts).toBeUndefined();
      expect(Object.keys(state)).not.toContain("disownedTilts");
    });
  });
});
