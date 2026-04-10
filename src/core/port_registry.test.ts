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
