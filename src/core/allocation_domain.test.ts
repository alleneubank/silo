import { expect, test } from "bun:test";
import path from "node:path";
import { accountHome, accountStorePath } from "./allocation_domain";

test("native account store is invariant under a scrubbed HOME", () => {
  const source = path.join(import.meta.dir, "allocation_domain.ts");
  const result = Bun.spawnSync([process.execPath, "-e", `import {accountStorePath} from ${JSON.stringify(source)}; console.log(accountStorePath())`], {
    env: { ...process.env, HOME: "/unrelated-invoking-home", SILO_PORT_REGISTRY_DIR: "/unrelated-old-registry" }, stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(accountStorePath());
  expect(path.isAbsolute(accountHome())).toBe(true);
  expect(accountStorePath()).not.toContain("/unrelated-invoking-home");
});
