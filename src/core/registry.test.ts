import { describe, expect, test } from "bun:test";
import { applyRegistryPortOverride, resolveRegistryAdvertiseSettings } from "./registry";
import { buildInstanceIdentity } from "./identity";
import type { InstanceState, ResolvedConfig } from "./types";

const baseConfig: ResolvedConfig = {
  version: 1,
  prefix: "localnet",
  output: ".localnet.env",
  ports: { K3D_REGISTRY_PORT: 5000 },
  portOrder: ["K3D_REGISTRY_PORT"],
  hosts: { APP_HOST: "${name}.localhost" },
  hostOrder: ["APP_HOST"],
  urls: { REGISTRY_URL: "http://localhost:${K3D_REGISTRY_PORT}" },
  urlOrder: ["REGISTRY_URL"],
  k3d: { enabled: true, registry: { enabled: true } },
  hooks: {},
  profiles: undefined,
  registry: undefined,
  configPath: "/repo/silo.toml",
  projectRoot: "/repo",
};

const buildState = (port: number, name = "demo"): InstanceState => {
  const ports = { K3D_REGISTRY_PORT: port };
  const hosts = { APP_HOST: "demo.localhost" };
  const identity = buildInstanceIdentity({
    name,
    prefix: baseConfig.prefix,
    hosts,
    ports,
    projectRoot: baseConfig.projectRoot,
    k3d: baseConfig.k3d,
  });
  return {
    name,
    ports,
    identity,
    createdAt: "2026-01-01T00:00:00.000Z",
    k3dClusterCreated: true,
  };
};

describe("applyRegistryPortOverride", () => {
  test("preserves the already-resolved kubeconfig when reconciling registry ports", () => {
    const state = buildState(49157);
    state.identity.kubeconfigPath = "/owned/project/.localnet/kubeconfig";
    const result = applyRegistryPortOverride({ state, config: baseConfig, actualPort: 49163 });
    expect(result.state.identity.kubeconfigPath).toBe("/owned/project/.localnet/kubeconfig");
  });
  test("updates registry port and urls when drift detected", () => {
    const state = buildState(49157);
    const result = applyRegistryPortOverride({
      state,
      config: baseConfig,
      actualPort: 49163,
    });

    expect(result.changed).toBe(true);
    expect(result.state.ports.K3D_REGISTRY_PORT).toBe(49163);
    expect(result.state.identity.k3dRegistryName).toBe(
      "localnet-demo-registry.localhost:49163"
    );
    expect(result.urls.REGISTRY_URL).toBe("http://localhost:49163");
  });

  test("keeps registry port when actual matches", () => {
    const state = buildState(49157);
    const result = applyRegistryPortOverride({
      state,
      config: baseConfig,
      actualPort: 49157,
    });

    expect(result.changed).toBe(false);
    expect(result.state.ports.K3D_REGISTRY_PORT).toBe(49157);
    expect(result.urls.REGISTRY_URL).toBe("http://localhost:49157");
  });
});

describe("resolveRegistryAdvertiseSettings", () => {
  test("throws when k3d hostFrom override does not match resolved registry identity", () => {
    const longName = "featured-app-implementation-with-very-long-name-hbn5";
    const state = buildState(49157, longName);
    const config: ResolvedConfig = {
      ...baseConfig,
      k3d: {
        enabled: true,
        registry: {
          enabled: true,
          hostFromContainerRuntime: "${prefix}-${name}-registry.localhost:5000",
        },
      },
    };

    expect(() =>
      resolveRegistryAdvertiseSettings({
        config,
        state,
        urls: {},
      })
    ).toThrow("k3d.registry.hostFromContainerRuntime resolves to");
  });

  test("supports safe hostFrom override using K3D_CLUSTER_NAME", () => {
    const longName = "featured-app-implementation-with-very-long-name-hbn5";
    const state = buildState(49157, longName);
    const config: ResolvedConfig = {
      ...baseConfig,
      k3d: {
        enabled: true,
        registry: {
          enabled: true,
          hostFromContainerRuntime: "${K3D_CLUSTER_NAME}-registry.localhost:5000",
        },
      },
    };

    const settings = resolveRegistryAdvertiseSettings({
      config,
      state,
      urls: {},
    });

    expect(settings).not.toBeNull();
    expect(settings?.hostFromContainerRuntime).toBe(
      `${state.identity.k3dClusterName}-registry.localhost:5000`
    );
  });

  test("throws when cluster-network host override does not match resolved registry identity", () => {
    const longName = "featured-app-implementation-with-very-long-name-hbn5";
    const state = buildState(49157, longName);
    const config: ResolvedConfig = {
      ...baseConfig,
      k3d: {
        enabled: true,
        registry: {
          enabled: true,
          hostFromClusterNetwork: "${prefix}-${name}-registry.localhost:5000",
        },
      },
    };

    expect(() =>
      resolveRegistryAdvertiseSettings({
        config,
        state,
        urls: {},
      })
    ).toThrow("k3d.registry.hostFromClusterNetwork resolves to");
  });
});
