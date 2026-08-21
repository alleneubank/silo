import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import {
  describeInstanceMismatch,
  findLiveDisowned,
  probeTilt,
  releaseTiltOwnership,
  resolveUpPreflight,
} from "./liveness";
import { readLockfile, writeLockfile } from "./lockfile";
import type { DisownedTilt, InstanceState } from "./types";

const buildInstance = (overrides: Partial<InstanceState> = {}): InstanceState => ({
  name: "team-hub",
  ports: { API_PORT: 8787, WEB_PORT: 5173 },
  identity: {
    name: "team-hub",
    prefix: "localnet",
    composeName: "localnet-team-hub",
    dockerNetwork: "localnet-team-hub",
    volumePrefix: "localnet-team-hub",
    containerPrefix: "localnet-team-hub-",
    hosts: { APP_HOST: "team-hub.localhost" },
  },
  createdAt: "2026-08-21T00:00:00.000Z",
  k3dClusterCreated: false,
  ...overrides,
});

const disownedEntry = (pid: number): DisownedTilt => ({
  pid,
  name: "team-hub",
  ports: { API_PORT: 8787 },
  disownedAt: "2026-08-20T00:00:00.000Z",
});

/** A probe that only the listed pids read as a live Tilt. */
const probeOnly =
  (...livePids: number[]) =>
  async (pid: number): Promise<boolean> =>
    livePids.includes(pid);

describe("probeTilt", () => {
  let tempDir: string;
  const spawned: Bun.Subprocess[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-liveness-"));
  });

  afterEach(async () => {
    spawned.forEach((proc) => proc.kill("SIGKILL"));
    spawned.length = 0;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // A symlink is enough to make `ps -o comm=` report a tilt-shaped name on
  // both macOS and Linux; copying a system binary breaks its signature.
  test("accepts a live process whose command names tilt", async () => {
    const fakeTilt = path.join(tempDir, "tilt-liveness-fixture");
    await fs.symlink("/bin/sleep", fakeTilt);
    const proc = Bun.spawn([fakeTilt, "30"], { stdout: "ignore", stderr: "ignore" });
    spawned.push(proc);

    expect(await probeTilt(proc.pid)).toBe(true);
  });

  // The pid-reuse case: the number is live, the process behind it is not ours.
  test("rejects a running process that is not the recorded Tilt", async () => {
    expect(await probeTilt(process.pid)).toBe(false);
  });

  test("rejects a pid that has exited", async () => {
    const proc = Bun.spawn(["/bin/sleep", "0"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;

    expect(await probeTilt(proc.pid)).toBe(false);
  });
});

describe("resolveUpPreflight", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "silo-preflight-"));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  test("starts when there is no lockfile", async () => {
    const preflight = await resolveUpPreflight({
      projectRoot,
      force: false,
      probe: probeOnly(),
    });

    expect(preflight.action).toBe("start");
  });

  test("starts when the lockfile records no Tilt", async () => {
    await writeLockfile(projectRoot, buildInstance());

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: false,
      probe: probeOnly(),
    });

    expect(preflight.action).toBe("start");
  });

  // The duplicate-stack guard: a second `silo up` must not fork another Tilt.
  test("reuses the instance when its Tilt is live", async () => {
    await writeLockfile(projectRoot, buildInstance({ tiltPid: 4242 }));

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: false,
      probe: probeOnly(4242),
    });

    expect(preflight).toMatchObject({ action: "reuse", pid: 4242 });
    expect(preflight.action === "reuse" && preflight.instance.name).toBe("team-hub");

    const lockfile = await readLockfile(projectRoot);
    expect(lockfile?.instance.tiltPid).toBe(4242);
  });

  // Pid reuse must not be mistaken for a live stack, or `up` would refuse to
  // start for as long as the number stays taken.
  test("starts when the recorded pid belongs to an unrelated process", async () => {
    await writeLockfile(projectRoot, buildInstance({ tiltPid: 4242 }));

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: false,
      probe: probeOnly(9999),
    });

    expect(preflight).toEqual({ action: "start", disowning: null });

    const lockfile = await readLockfile(projectRoot);
    expect(lockfile?.instance.tiltPid).toBe(4242);
  });

  // After a --force handover that failed partway, or after the replacement it
  // started has exited, nobody owns the lockfile while a stack is still up.
  // Starting here would be the silent duplicate the guard exists to prevent.
  test("blocks when a disowned stack is running and nothing owns the lockfile", async () => {
    await writeLockfile(
      projectRoot,
      buildInstance({ disownedTilts: [disownedEntry(111), disownedEntry(222)] })
    );

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: false,
      probe: probeOnly(222),
    });

    expect(preflight.action).toBe("blocked");
    expect(
      preflight.action === "blocked" &&
        preflight.liveDisowned.map((entry) => entry.pid)
    ).toEqual([222]);
  });

  test("starts when every disowned stack has exited", async () => {
    await writeLockfile(
      projectRoot,
      buildInstance({ disownedTilts: [disownedEntry(111)] })
    );

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: false,
      probe: probeOnly(),
    });

    expect(preflight).toEqual({ action: "start", disowning: null });
  });

  test("--force starts beside a live disowned stack rather than blocking", async () => {
    await writeLockfile(
      projectRoot,
      buildInstance({ disownedTilts: [disownedEntry(222)] })
    );

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: true,
      probe: probeOnly(222),
    });

    expect(preflight).toEqual({ action: "start", disowning: null });
  });

  test("--force reports the stack it is about to displace, with its ports", async () => {
    await writeLockfile(
      projectRoot,
      buildInstance({ tiltPid: 4242, tiltStartedAt: "2026-08-21T01:00:00.000Z" })
    );

    const preflight = await resolveUpPreflight({
      projectRoot,
      force: true,
      probe: probeOnly(4242),
    });

    expect(preflight.action).toBe("start");
    expect(preflight.action === "start" && preflight.disowning).toMatchObject({
      pid: 4242,
      name: "team-hub",
      ports: { API_PORT: 8787, WEB_PORT: 5173 },
      startedAt: "2026-08-21T01:00:00.000Z",
    });
  });

  // The transfer is written only by the run that succeeds in replacing the
  // stack. Recording it here would leave a live stack with no tiltPid if the
  // rest of `up` then failed, and the next ordinary `up` would duplicate it.
  test("--force does not touch the lockfile", async () => {
    await writeLockfile(
      projectRoot,
      buildInstance({ tiltPid: 4242, tiltStartedAt: "2026-08-21T01:00:00.000Z" })
    );
    const before = await readLockfile(projectRoot);

    await resolveUpPreflight({
      projectRoot,
      force: true,
      probe: probeOnly(4242),
    });

    expect(await readLockfile(projectRoot)).toEqual(before);
  });
});

describe("releaseTiltOwnership", () => {
  test("clears the pid it recorded when that Tilt exits", () => {
    const released = releaseTiltOwnership({
      instance: buildInstance({ tiltPid: 4242, tiltStartedAt: "2026-08-21T01:00:00.000Z" }),
      pid: 4242,
    });

    expect(released.tiltPid).toBeUndefined();
    expect(released.tiltStartedAt).toBeUndefined();
  });

  // After `up --force` the lockfile belongs to the replacement. The displaced
  // `silo up` exiting later must not erase it, or `status` reports stopped and
  // `down` cannot reach the stack that is actually running.
  test("leaves a replacement stack's ownership alone", () => {
    const released = releaseTiltOwnership({
      instance: buildInstance({
        tiltPid: 5555,
        tiltStartedAt: "2026-08-21T02:00:00.000Z",
        disownedTilts: [disownedEntry(4242)],
      }),
      pid: 4242,
    });

    expect(released.tiltPid).toBe(5555);
    expect(released.tiltStartedAt).toBe("2026-08-21T02:00:00.000Z");
    expect(released.disownedTilts).toBeUndefined();
  });

  test("keeps disowned stacks that are not the one exiting", () => {
    const released = releaseTiltOwnership({
      instance: buildInstance({
        tiltPid: 5555,
        disownedTilts: [disownedEntry(111), disownedEntry(4242)],
      }),
      pid: 4242,
    });

    expect(released.disownedTilts?.map((entry) => entry.pid)).toEqual([111]);
  });
});

describe("findLiveDisowned", () => {
  test("returns nothing when no stack was ever disowned", async () => {
    expect(await findLiveDisowned({ disowned: undefined, probe: probeOnly() })).toEqual(
      []
    );
  });

  test("drops entries whose process is gone", async () => {
    const live = await findLiveDisowned({
      disowned: [disownedEntry(111), disownedEntry(222)],
      probe: probeOnly(222),
    });

    expect(live.map((entry) => entry.pid)).toEqual([222]);
  });
});

describe("describeInstanceMismatch", () => {
  test("accepts a request that names the running instance", () => {
    expect(
      describeInstanceMismatch({
        instance: buildInstance({ profile: "testnet" }),
        requestedName: "team-hub",
        requestedProfile: "testnet",
      })
    ).toBeNull();
  });

  test("accepts a request that names nothing in particular", () => {
    expect(
      describeInstanceMismatch({
        instance: buildInstance({ profile: "testnet" }),
        requestedName: undefined,
        requestedProfile: undefined,
      })
    ).toBeNull();
  });

  // Reusing here would report success for an instance the caller did not ask
  // for, silently ignoring the name they typed.
  test("rejects a request for a different instance name", () => {
    expect(
      describeInstanceMismatch({
        instance: buildInstance(),
        requestedName: "feature-y",
        requestedProfile: undefined,
      })
    ).toBe("it is running as 'team-hub', not 'feature-y'");
  });

  test("rejects a request for a different profile", () => {
    expect(
      describeInstanceMismatch({
        instance: buildInstance({ profile: "testnet" }),
        requestedName: undefined,
        requestedProfile: "devnet",
      })
    ).toBe("it is running with profile 'testnet', not profile 'devnet'");
  });

  test("rejects a profile request when the instance runs the base config", () => {
    expect(
      describeInstanceMismatch({
        instance: buildInstance(),
        requestedName: undefined,
        requestedProfile: "devnet",
      })
    ).toBe("it is running with the base config, not profile 'devnet'");
  });
});
