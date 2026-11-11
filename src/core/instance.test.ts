import { expect, test } from "bun:test";
import path from "node:path";
import { parseConfig } from "./config";
import { buildInstanceState } from "./instance";
import { buildEnvVars, buildSiloProcessEnv } from "./env";
import { resourceClaims } from "./resource_claims";

test("one allocated state renders consistent env, URLs, registry, kubeconfig and final name claims", () => {
  const root = path.join(import.meta.dir, "fixture");
  const config = parseConfig(`version=1\n[ports]\nAPP_PORT=3000\nK3D_REGISTRY_PORT=5000\n[hosts]\nAPP_HOST="\u0024{name}.localhost"\n[urls]\nAPP_URL="http://\u0024{APP_HOST}:\u0024{APP_PORT}"\n[k3d]\nenabled=true\nkubeconfigPath=".localnet/kubeconfig"\nargs=["--port=\u0024{APP_PORT}:80@loadbalancer"]\n[k3d.registry]\nenabled=true\n`, path.join(root, "silo.toml"));
  const instance = buildInstanceState({ config, name: "feature-x", profile: undefined, ports: { APP_PORT: 49152, K3D_REGISTRY_PORT: 49153 }, createdAt: "2026-01-01T00:00:00Z" });
  const env = buildEnvVars(instance.state, instance.urls);
  expect(env.APP_URL).toBe("http://feature-x.localhost:49152");
  expect(env.KUBECONFIG).toBe(path.join(root, ".localnet/kubeconfig"));
  expect(env.K3D_REGISTRY_NAME).toBe("localnet-feature-x-registry.localhost:49153");
  expect(instance.k3dArgs).toEqual(["--port=49152:80@loadbalancer"]);
  const claims = resourceClaims(instance.state, config);
  expect(claims).toContainEqual({ domain: "host-port", resource: "49152" });
  expect(claims.some(c => c.domain === "container" && (c.prefix ? "localnet-feature-x-registry.localhost".startsWith(c.resource) : c.resource === "localnet-feature-x-registry.localhost"))).toBe(true);
  expect(buildSiloProcessEnv({ state: instance.state, envFilePath: path.join(root, ".localnet.env"), projectId: "project-id", generation: 7 })).toMatchObject({ SILO_PROJECT_ID: "project-id", SILO_GENERATION: "7", SILO_ACTIVE: "1" });
});
