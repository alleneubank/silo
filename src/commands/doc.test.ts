import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "path";
import { DOC_TOPICS } from "./doc-topics";
import { doc } from "./doc";

const docsRoot = path.resolve(import.meta.dir, "..", "..", "docs");
let distributionRoot: string;

beforeAll(async () => {
  distributionRoot = mkdtempSync(path.join(os.tmpdir(), "silo-doc-distributions-"));
  for (const [name, flags] of [["cli.js", ["--target=bun"]], ["silo", ["--compile"]]] as const) {
    const build = Bun.spawn(["nice", "-n", "15", process.execPath, "build", path.resolve(import.meta.dir, "../cli.ts"), ...flags, "--outfile", path.join(distributionRoot, name)], {
      stdout: "pipe", stderr: "pipe", timeout: 60_000,
    });
    const [exitCode, stderr] = await Promise.all([build.exited, new Response(build.stderr).text()]);
    if (exitCode !== 0) throw new Error(`Doc distribution build failed: ${stderr}`);
  }
}, 90_000);

afterAll(() => { if (distributionRoot) rmSync(distributionRoot, { recursive: true }); });

for (const distribution of ["cli.js", "silo"] as const) {
  it(`${distribution} prints every listed topic outside the source tree`, async () => {
    const command = distribution === "silo" ? [path.join(distributionRoot, distribution)] : [process.execPath, path.join(distributionRoot, distribution)];
    const run = async (...args: string[]) => {
      const proc = Bun.spawn([...command, "doc", ...args], { cwd: distributionRoot, stdout: "pipe", stderr: "pipe", timeout: 10_000 });
      const [exitCode, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      return stdout;
    };
    const topics = (await run("--list")).trim().split("\n");
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) {
      const entry = DOC_TOPICS[topic];
      expect(entry).toBeDefined();
      const contents = await Bun.file(path.join(docsRoot, entry!.file)).text();
      expect(await run(topic)).toBe(contents.trimEnd() + "\n");
    }
    expect(await run("silo.toml")).toBe(await run("config"));
  }, 60_000);
}

const captureStdout = async (fn: () => Promise<void>): Promise<string> => {
  let output = "";
  const originalWrite = process.stdout.write;
  const originalLog = console.log;

  (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = (
    chunk: string | Uint8Array
  ) => {
    if (typeof chunk === "string") {
      output += chunk;
    } else {
      output += Buffer.from(chunk).toString("utf-8");
    }
    return true;
  };

  console.log = (...args: unknown[]) => {
    output += `${args.map((arg) => String(arg)).join(" ")}\n`;
  };

  try {
    await fn();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }

  return output;
};

describe("doc topics", () => {
  it("prints docs for each topic", async () => {
    for (const [topic, entry] of Object.entries(DOC_TOPICS)) {
      const docPath = path.join(docsRoot, entry.file);
      const contents = await Bun.file(docPath).text();
      const output = await captureStdout(async () => {
        await doc({ topic });
      });
      expect(output).toBe(contents.trimEnd() + "\n");
    }
  });

  it("lists topics in plain text", async () => {
    const output = await captureStdout(async () => {
      await doc({ list: true });
    });
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const expected = Object.keys(DOC_TOPICS);
    expect(lines).toEqual(expected);
  });

  it("prints topics as json", async () => {
    const output = await captureStdout(async () => {
      await doc({ json: true });
    });
    const parsed = JSON.parse(output) as { topics: Array<{ topic: string }> };
    const topics = parsed.topics.map((entry) => entry.topic);
    expect(topics).toEqual(Object.keys(DOC_TOPICS));
  });

  it("lists available topics when the topic is unknown", async () => {
    let message = "";
    try {
      await doc({ topic: "nope" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Unknown doc topic: nope");
    expect(message).toContain("Available:");
    expect(message).toContain("tilt");
  });

});
