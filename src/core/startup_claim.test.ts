import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { STARTUP_CLAIM_NAME } from "./constants";
import { withStartupClaim } from "./startup_claim";

describe("withStartupClaim", () => {
  let projectRoot: string;
  let claimFile: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "silo-claim-"));
    claimFile = path.join(projectRoot, STARTUP_CLAIM_NAME);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  test("releases the claim when startup finishes", async () => {
    const result = await withStartupClaim(projectRoot, async () => {
      expect(await fs.exists(claimFile)).toBe(true);
      return "started";
    });

    expect(result).toBe("started");
    expect(await fs.exists(claimFile)).toBe(false);
  });

  test("releases the claim when startup throws", async () => {
    await expect(
      withStartupClaim(projectRoot, async () => {
        throw new Error("k3d failed");
      })
    ).rejects.toThrow("k3d failed");

    expect(await fs.exists(claimFile)).toBe(false);
  });

  // The race the lockfile cannot cover: both runs read a lockfile with no
  // tiltPid, so only the claim can keep the second one from starting a stack.
  test("refuses to start while another silo is starting this project", async () => {
    await withStartupClaim(projectRoot, async () => {
      await expect(
        withStartupClaim(projectRoot, async () => "second")
      ).rejects.toThrow(/Another 'silo up' is starting this project/);
    });
  });

  test("takes over a claim whose owner is gone", async () => {
    const dead = Bun.spawn(["/bin/sleep", "0"], { stdout: "ignore", stderr: "ignore" });
    await dead.exited;
    await fs.writeFile(
      claimFile,
      JSON.stringify({
        pid: dead.pid,
        nonce: "dead-owner",
        claimedAt: new Date().toISOString(),
      })
    );

    expect(await withStartupClaim(projectRoot, async () => "started")).toBe("started");
    expect(await fs.exists(claimFile)).toBe(false);
  });

  test("takes over a claim that cannot be read", async () => {
    await fs.writeFile(claimFile, "{ truncated");

    expect(await withStartupClaim(projectRoot, async () => "started")).toBe("started");
  });

  // A live pid holds the claim for as long as it runs: hooks and k3d creation
  // can legitimately take many minutes, and reclaiming under a live starter is
  // what would produce the duplicate stack.
  test("waits on a live starter no matter how long it has held the claim", async () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      claimFile,
      JSON.stringify({ pid: process.pid, nonce: "live-owner", claimedAt: longAgo })
    );

    await expect(
      withStartupClaim(projectRoot, async () => "started")
    ).rejects.toThrow(/Another 'silo up' is starting this project/);
  });

  test("takes over a claim whose pid was recycled long ago", async () => {
    const ancient = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await fs.writeFile(
      claimFile,
      JSON.stringify({ pid: process.pid, nonce: "recycled", claimedAt: ancient })
    );

    expect(await withStartupClaim(projectRoot, async () => "started")).toBe("started");
  });

  // Reclaim is remove-then-create, so a second reclaimer can replace the file
  // between the two. The nonce is what settles who actually owns the startup.
  test("backs off when another silo won the same reclaim", async () => {
    const dead = Bun.spawn(["/bin/sleep", "0"], { stdout: "ignore", stderr: "ignore" });
    await dead.exited;
    await fs.writeFile(
      claimFile,
      JSON.stringify({ pid: dead.pid, nonce: "abandoned", claimedAt: new Date().toISOString() })
    );

    const [first, second] = await Promise.allSettled([
      withStartupClaim(projectRoot, async () => {
        await Bun.sleep(20);
        return "first";
      }),
      withStartupClaim(projectRoot, async () => {
        await Bun.sleep(20);
        return "second";
      }),
    ]);

    const winners = [first, second].filter((r) => r.status === "fulfilled");
    expect(winners).toHaveLength(1);
  });

  test("does not remove a successor's claim on release", async () => {
    await withStartupClaim(projectRoot, async () => {
      // A later silo replaced the claim (only possible if this one looked
      // abandoned); releasing must not delete what it now holds.
      await fs.writeFile(
        claimFile,
        JSON.stringify({
          pid: process.pid,
          nonce: "successor",
          claimedAt: new Date().toISOString(),
        })
      );
    });

    const remaining = JSON.parse(await fs.readFile(claimFile, "utf8"));
    expect(remaining.nonce).toBe("successor");
  });
});
