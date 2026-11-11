import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { processAbsent } from "../core/lease_store";
import { withTimeout } from "./timeout";

let base: string;
beforeAll(() => { base = mkdtempSync(path.join(os.tmpdir(), "silo-probe-interrupt-")); });
afterAll(() => { if (base) rmSync(base, { recursive: true }); });

for (const kind of ["docker", "k3d", "ps", "lsof", "command-v"]) {
  test(`${kind} probe exposes nonzero status only outside an interrupted command`, async () => {
    const root = path.join(base, kind);
    mkdirSync(root);
    const tool = path.join(root, kind);
    writeFileSync(tool, `#!/bin/sh
echo $$ > ${JSON.stringify(path.join(root, "probe.pid"))}
if test "$1" != completed; then kill -INT "$PPID"; fi
exit 7
`, { mode: 0o755 });
    for (const mode of ["completed", "interrupted", "ambient"]) {
      const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/probe_cli.ts"), tool, mode], {
        cwd: root, detached: true, stdout: "pipe", stderr: "pipe", timeout: 15_000,
      });
      writeFileSync(path.join(root, `${mode}.pid`), String(proc.pid));
      const output = new Response(proc.stdout).text();
      const errors = new Response(proc.stderr).text();
      try {
        const [exitCode, stdout, stderr] = await withTimeout({ result: Promise.all([proc.exited, output, errors]), cancel: () => {
          if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        } }, 12_000, "probe interruption");
        expect(stderr).toBe("");
        expect(exitCode).toBe(mode === "completed" ? 0 : 130);
        if (mode !== "completed") expect(JSON.parse(stdout)).toMatchObject({ code: "INTERRUPTED" });
        else expect(JSON.parse(stdout)).toMatchObject({ exitCode: 7 });
        expect(processAbsent(Number(readFileSync(path.join(root, "probe.pid"), "utf8")))).toBe(true);
      } finally {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
        await proc.exited;
        await errors;
      }
    }
  }, 30_000);
}
