import { describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { loadConfig } from "./config";
import { applyProfile } from "./profile";

const withConfig = async (section: string, run: (configPath: string) => Promise<void>) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-config-"));
  try {
    const configPath = path.join(dir, "silo.toml");
    await fs.writeFile(configPath, `version = 1\n[ports]\nTILT_PORT = "random"\n${section}\n`);
    await run(configPath);
  } finally {
    await fs.rm(dir, { recursive: true });
  }
};

describe("loadConfig", () => {
  test("accepts owned kubeconfig and production Tilt mode, including profile overrides", async () => {
    await withConfig(`
[k3d]
enabled = true
kubeconfigPath = ".localnet/kubeconfig"
[tilt]
webMode = "prod"
[profiles.private.k3d]
kubeconfigPath = ".private/kubeconfig"
[profiles.private.tilt]
webMode = "prod"
`, async (configPath) => {
      const config = await loadConfig(configPath);
      expect(String(config.k3d?.kubeconfigPath)).toBe(".localnet/kubeconfig");
      expect(config.tilt?.webMode).toBe("prod");
      const profiled = applyProfile(config, "private");
      expect(profiled.k3d?.enabled).toBe(true);
      expect(String(profiled.k3d?.kubeconfigPath)).toBe(".private/kubeconfig");
      expect(profiled.tilt?.webMode).toBe("prod");
    });
  });

  test.each(["", ".", "..", "../kubeconfig", ".localnet/../../kubeconfig", "/tmp/kubeconfig", "~/kubeconfig", "C:/kubeconfig", "dir\\kubeconfig", "a:b", "${name}/kubeconfig"])(
    "rejects kubeconfig path %j in base and profile config", async (value) => {
      for (const table of ["k3d", "profiles.private.k3d"]) {
        await withConfig(`[${table}]\nenabled = true\nkubeconfigPath = ${JSON.stringify(value)}`, async (configPath) => {
          await expect(loadConfig(configPath)).rejects.toThrow("project-relative");
        });
      }
    }
  );

  test.each(["local", "dev", "default", "", "PROD"])("rejects unsupported Tilt web mode %j", async (value) => {
    for (const table of ["tilt", "profiles.private.tilt"]) {
      await withConfig(`[${table}]\nwebMode = ${JSON.stringify(value)}`, async (configPath) => {
        await expect(loadConfig(configPath)).rejects.toThrow();
      });
    }
  });

  test("accepts random ports and 0 as an alias", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-config-"));
    try {
      const configPath = path.join(tempDir, "silo.toml");
      await fs.writeFile(
        configPath,
        `version = 1

[ports]
WEB_PORT = "random"
API_PORT = 0
`
      );

      const config = await loadConfig(configPath);
      expect(config.ports.WEB_PORT).toBe("random");
      expect(config.ports.API_PORT).toBe("random");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test("accepts registry advertisement settings", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-config-"));
    try {
      const configPath = path.join(tempDir, "silo.toml");
      const content = [
        "version = 1",
        "",
        "[ports]",
        "K3D_REGISTRY_PORT = 5000",
        "",
        "[k3d]",
        "enabled = true",
        "",
        "[k3d.registry]",
        "enabled = true",
        "advertise = true",
        'host = "localhost:${K3D_REGISTRY_PORT}"',
        'hostFromContainerRuntime = "registry.localhost:5000"',
        'hostFromClusterNetwork = "registry.localhost:5000"',
        'help = "See docs"',
        "",
        "[registry]",
        "advertise = true",
        'host = "127.0.0.1:5001"',
        "",
      ].join("\n");
      await fs.writeFile(configPath, content);

      const config = await loadConfig(configPath);
      expect(config.k3d?.registry?.enabled).toBe(true);
      expect(config.k3d?.registry?.advertise).toBe(true);
      expect(config.k3d?.registry?.host).toBe("localhost:${K3D_REGISTRY_PORT}");
      expect(config.registry?.advertise).toBe(true);
      expect(config.registry?.host).toBe("127.0.0.1:5001");
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
