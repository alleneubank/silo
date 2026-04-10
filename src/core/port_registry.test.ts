import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "path";
import os from "os";
import { promises as fs } from "fs";
import {
  readPeerPorts,
  registerInstance,
  unregisterInstance,
} from "./port_registry";

const tmpRoot = async (prefix: string): Promise<string> =>
  await fs.mkdtemp(path.join(os.tmpdir(), prefix));

const writeLockfile = async (projectRoot: string): Promise<void> => {
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".silo.lock"), "{}");
};

describe("port_registry", () => {
  let registryDir: string;
  let projectA: string;
  let projectB: string;
  let projectC: string;

  beforeEach(async () => {
    registryDir = await tmpRoot("silo-registry-");
    projectA = await tmpRoot("silo-proj-a-");
    projectB = await tmpRoot("silo-proj-b-");
    projectC = await tmpRoot("silo-proj-c-");
    await writeLockfile(projectA);
    await writeLockfile(projectB);
    await writeLockfile(projectC);
  });

  afterEach(async () => {
    await fs.rm(registryDir, { recursive: true, force: true });
    await fs.rm(projectA, { recursive: true, force: true });
    await fs.rm(projectB, { recursive: true, force: true });
    await fs.rm(projectC, { recursive: true, force: true });
  });

  test("readPeerPorts returns empty when registry dir is missing", async () => {
    const missing = path.join(registryDir, "does-not-exist");
    const ports = await readPeerPorts({
      excludeProjectRoot: projectA,
      registryDir: missing,
    });
    expect(ports.size).toBe(0);
  });

  test("register, read, unregister roundtrip", async () => {
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [49152, 49153, 49154],
      registryDir,
    });

    const seen = await readPeerPorts({
      excludeProjectRoot: projectB,
      registryDir,
    });
    expect(seen.has(49152)).toBe(true);
    expect(seen.has(49153)).toBe(true);
    expect(seen.has(49154)).toBe(true);

    await unregisterInstance({ projectRoot: projectA, registryDir });

    const after = await readPeerPorts({
      excludeProjectRoot: projectB,
      registryDir,
    });
    expect(after.size).toBe(0);
  });

  test("readPeerPorts excludes the caller's own project", async () => {
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [50000, 50001],
      registryDir,
    });

    const peersFromA = await readPeerPorts({
      excludeProjectRoot: projectA,
      registryDir,
    });
    expect(peersFromA.size).toBe(0);
  });

  test("two different projects get aggregated ports from the registry", async () => {
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [49152, 49153],
      registryDir,
    });
    await registerInstance({
      projectRoot: projectB,
      name: "wt-b",
      ports: [49154, 49155],
      registryDir,
    });

    const seenFromC = await readPeerPorts({
      excludeProjectRoot: projectC,
      registryDir,
    });
    expect(seenFromC.has(49152)).toBe(true);
    expect(seenFromC.has(49153)).toBe(true);
    expect(seenFromC.has(49154)).toBe(true);
    expect(seenFromC.has(49155)).toBe(true);
    expect(seenFromC.size).toBe(4);
  });

  test("stale entries (missing lockfile) are garbage-collected on read", async () => {
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [49152],
      registryDir,
    });
    // Simulate the project going away without calling unregister.
    await fs.rm(path.join(projectA, ".silo.lock"), { force: true });

    const seen = await readPeerPorts({
      excludeProjectRoot: projectB,
      registryDir,
    });
    expect(seen.size).toBe(0);

    // The registry file should also be removed as part of GC.
    const registryFiles = await fs.readdir(registryDir);
    expect(registryFiles.length).toBe(0);
  });

  test("corrupt registry entries are garbage-collected on read", async () => {
    await fs.mkdir(registryDir, { recursive: true });
    await fs.writeFile(path.join(registryDir, "corrupt.json"), "not json {");

    const seen = await readPeerPorts({
      excludeProjectRoot: projectA,
      registryDir,
    });
    expect(seen.size).toBe(0);

    const files = await fs.readdir(registryDir);
    expect(files.includes("corrupt.json")).toBe(false);
  });

  test("entry registered before lockfile exists is GC'd on peer read", async () => {
    // Regression test for the register-before-lockfile race: if an instance
    // registers its ports before writing .silo.lock, a concurrent peer read
    // would see no lockfile and GC the entry. The fix is to register AFTER
    // the lockfile is on disk — but this test locks in the invariant that
    // callers must respect the order.
    const projectX = await tmpRoot("silo-no-lock-");
    try {
      await registerInstance({
        projectRoot: projectX,
        name: "wt-x",
        ports: [51000],
        registryDir,
      });
      // No lockfile at projectX — the entry is "stale" by definition.
      const seen = await readPeerPorts({
        excludeProjectRoot: projectA,
        registryDir,
      });
      expect(seen.has(51000)).toBe(false);
    } finally {
      await fs.rm(projectX, { recursive: true, force: true });
    }
  });

  test("entry registered AFTER lockfile exists survives peer read", async () => {
    // The correct ordering: write lockfile first, then register. Peer
    // reads then see the entry as live and include its ports.
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [52000, 52001],
      registryDir,
    });
    const seen = await readPeerPorts({
      excludeProjectRoot: projectB,
      registryDir,
    });
    expect(seen.has(52000)).toBe(true);
    expect(seen.has(52001)).toBe(true);
  });

  test("two projects whose paths collide under FNV-1a 32-bit get distinct registry files", async () => {
    // Regression test for review cycle 3: the previous implementation
    // keyed registry files by a 32-bit FNV-1a hash. Two different absolute
    // project roots could hash to the same filename, so the second
    // registration would overwrite the first and both projects would then
    // treat the shared file as "self", losing isolation. The reviewer
    // reproduced this with `/Users/allen/collision-test/hirjqfoz3x2c9l`
    // and `/Users/allen/collision-test/2wblm5976j31rg` (both FNV-1a
    // fcd32db2). With SHA-256, the chance of collision is astronomically
    // small. We construct the reviewer's two colliding paths as temp
    // fixtures and assert both land in distinct registry files AND both
    // are visible as peers from a third project.
    const collisionBase = await tmpRoot("silo-collision-");
    const projectP = path.join(collisionBase, "hirjqfoz3x2c9l");
    const projectQ = path.join(collisionBase, "2wblm5976j31rg");
    try {
      await writeLockfile(projectP);
      await writeLockfile(projectQ);

      await registerInstance({
        projectRoot: projectP,
        name: "wt-p",
        ports: [53000, 53001],
        registryDir,
      });
      await registerInstance({
        projectRoot: projectQ,
        name: "wt-q",
        ports: [53100, 53101],
        registryDir,
      });

      // Both registrations must survive — if the second overwrote the
      // first, the registry dir would contain only one file.
      const files = (await fs.readdir(registryDir)).filter((f) =>
        f.endsWith(".json")
      );
      expect(files.length).toBeGreaterThanOrEqual(2);

      // A third project must see BOTH registered instances as peers.
      const seenFromOther = await readPeerPorts({
        excludeProjectRoot: projectA,
        registryDir,
      });
      expect(seenFromOther.has(53000)).toBe(true);
      expect(seenFromOther.has(53001)).toBe(true);
      expect(seenFromOther.has(53100)).toBe(true);
      expect(seenFromOther.has(53101)).toBe(true);

      // When read from one of the colliding projects, the other must
      // still be visible (it's NOT self).
      const seenFromP = await readPeerPorts({
        excludeProjectRoot: projectP,
        registryDir,
      });
      expect(seenFromP.has(53000)).toBe(false);
      expect(seenFromP.has(53100)).toBe(true);

      const seenFromQ = await readPeerPorts({
        excludeProjectRoot: projectQ,
        registryDir,
      });
      expect(seenFromQ.has(53100)).toBe(false);
      expect(seenFromQ.has(53000)).toBe(true);
    } finally {
      await fs.rm(collisionBase, { recursive: true, force: true });
    }
  });

  test("re-registering the same project overwrites the prior entry", async () => {
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [49152, 49153],
      registryDir,
    });
    await registerInstance({
      projectRoot: projectA,
      name: "wt-a",
      ports: [50000, 50001, 50002],
      registryDir,
    });

    const seen = await readPeerPorts({
      excludeProjectRoot: projectB,
      registryDir,
    });
    expect(seen.has(49152)).toBe(false);
    expect(seen.has(49153)).toBe(false);
    expect(seen.has(50000)).toBe(true);
    expect(seen.has(50001)).toBe(true);
    expect(seen.has(50002)).toBe(true);
  });
});
