import { describe, expect, it } from "bun:test";
import path from "path";
import { DOC_TOPICS } from "./doc-topics";
import { doc } from "./doc";

const docsRoot = path.resolve(import.meta.dir, "..", "..", "docs");

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
  it("all doc files exist", async () => {
    for (const entry of Object.values(DOC_TOPICS)) {
      const docPath = path.join(docsRoot, entry.file);
      const exists = await Bun.file(docPath).exists();
      expect(exists).toBe(true);
    }
  });

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

  it("documents npm-based Tilt extension loading for CI", async () => {
    const docPath = path.join(docsRoot, "tilt.md");
    const contents = await Bun.file(docPath).text();
    expect(contents).toContain(
      "load('./node_modules/@0xbigboss/silo/tilt-extensions/silo/require/Tiltfile', 'SILO_REQUIRE')"
    );
    expect(contents).toContain("CI environments");
  });
});
