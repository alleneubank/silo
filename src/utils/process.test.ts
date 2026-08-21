import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import {
  excludeKnownStacks,
  findTiltPidsInDir,
  getProcessCwd,
  isTrackedTiltCommand,
  readProcessTable,
} from "./process";

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

describe("getProcessCwd", () => {
  let dir: string;
  const spawned: Bun.Subprocess[] = [];

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "silo-cwd-")));
  });

  afterEach(async () => {
    spawned.forEach((proc) => proc.kill("SIGKILL"));
    spawned.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
  });

  // The directory a process runs in is not in its argv, which is why matching
  // it with a `pgrep -f` pattern never worked.
  test("reads the directory a process is actually running in", async () => {
    const proc = Bun.spawn(["/bin/sleep", "30"], {
      cwd: dir,
      stdout: "ignore",
      stderr: "ignore",
    });
    spawned.push(proc);

    expect(await getProcessCwd(proc.pid)).toBe(dir);
  });

  test("returns null for a process that has exited", async () => {
    const proc = Bun.spawn(["/bin/sleep", "0"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;

    expect(await getProcessCwd(proc.pid)).toBeNull();
  });
});

describe("findTiltPidsInDir", () => {
  let dir: string;
  let sibling: string;
  const spawned: Bun.Subprocess[] = [];

  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "silo-tiltdir-")));
    sibling = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "silo-other-")));
  });

  afterEach(async () => {
    spawned.forEach((proc) => proc.kill("SIGKILL"));
    spawned.length = 0;
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(sibling, { recursive: true, force: true });
  });

  test("finds a tilt-shaped process by the directory it runs in", async () => {
    const fakeTilt = path.join(dir, "tilt-fixture");
    await fs.symlink("/bin/sleep", fakeTilt);
    const proc = Bun.spawn([fakeTilt, "30"], {
      cwd: dir,
      stdout: "ignore",
      stderr: "ignore",
    });
    spawned.push(proc);

    expect(await findTiltPidsInDir(dir)).toContain(proc.pid);
    expect(await findTiltPidsInDir(sibling)).not.toContain(proc.pid);
  });
});

describe("excludeKnownStacks", () => {
  // silo records the supervisor; the supervisor runs tilt as a child in a
  // group of its own, so neither pid nor group alone identifies the stack.
  const table = [
    { pid: 100, ppid: 10, pgid: 10 }, // supervisor silo recorded
    { pid: 101, ppid: 100, pgid: 101 }, // tilt it started, own group
    { pid: 102, ppid: 101, pgid: 101 }, // something tilt started
    { pid: 900, ppid: 1, pgid: 900 }, // a tilt started by hand
  ];

  test("keeps a Tilt that belongs to no known stack", () => {
    expect(excludeKnownStacks({ candidates: [900], known: [100], table })).toEqual([
      900,
    ]);
  });

  test("drops the recorded pid itself", () => {
    expect(excludeKnownStacks({ candidates: [100], known: [100], table })).toEqual([]);
  });

  test("drops the tilt a recorded supervisor started", () => {
    expect(excludeKnownStacks({ candidates: [101], known: [100], table })).toEqual([]);
  });

  test("drops a descendant deeper than one level", () => {
    expect(excludeKnownStacks({ candidates: [102], known: [100], table })).toEqual([]);
  });

  test("drops a process sharing a recorded stack's group", () => {
    expect(
      excludeKnownStacks({
        candidates: [201],
        known: [100],
        table: [...table, { pid: 201, ppid: 1, pgid: 10 }],
      })
    ).toEqual([]);
  });

  test("keeps everything when silo has recorded no stack", () => {
    expect(excludeKnownStacks({ candidates: [101, 900], known: [], table })).toEqual([
      101, 900,
    ]);
  });

  // A pid missing from the table has already exited; it cannot be attributed
  // to a known stack, and refusing on it would block startup on a ghost.
  test("keeps a candidate the process table does not describe", () => {
    expect(excludeKnownStacks({ candidates: [777], known: [100], table })).toEqual([
      777,
    ]);
  });

  test("terminates on a cyclic parent chain", () => {
    expect(
      excludeKnownStacks({
        candidates: [301],
        known: [100],
        table: [
          { pid: 301, ppid: 302, pgid: 301 },
          { pid: 302, ppid: 301, pgid: 301 },
        ],
      })
    ).toEqual([301]);
  });
});

describe("readProcessTable", () => {
  test("describes this process and its parent", async () => {
    const table = await readProcessTable();
    const self = table.find((row) => row.pid === process.pid);

    expect(self).toBeDefined();
    expect(self?.ppid).toBeGreaterThan(0);
    expect(self?.pgid).toBeGreaterThan(0);
  });
});
