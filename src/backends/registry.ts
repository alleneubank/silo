import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { KUBECTL_APPLY_TIMEOUT_MS } from "../core/constants";
import { runProducerCommand } from "./ownership";
import type { ProjectOperation } from "../core/lease_store";
import { withRetry } from "../utils/retry";

const buildConfigMap = (
  host: string,
  hostFromContainerRuntime?: string,
  hostFromClusterNetwork?: string,
  help?: string
): string => {
  const hostLine = `    host: "${host}"`;
  const runtimeLine = hostFromContainerRuntime
    ? `\n    hostFromContainerRuntime: "${hostFromContainerRuntime}"`
    : "";
  const clusterLine = hostFromClusterNetwork
    ? `\n    hostFromClusterNetwork: "${hostFromClusterNetwork}"`
    : "";
  const helpLine = help ? `\n    help: "${help}"` : "";
  return `apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
${hostLine}${runtimeLine}${clusterLine}${helpLine}
`;
};

export const advertiseLocalRegistry = async (params: {
  owner: ProjectOperation;
  registryHost: string;
  registryHostFromContainerRuntime?: string;
  registryHostFromClusterNetwork?: string;
  help?: string;
  kubeconfigPath?: string;
  retry: {
    attempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
}): Promise<void> => {
  const {
    registryHost,
    registryHostFromContainerRuntime,
    registryHostFromClusterNetwork,
    help,
    kubeconfigPath,
    owner,
    retry,
  } = params;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "silo-registry-"));
  const manifestPath = path.join(tmpDir, "local-registry-hosting.yaml");
  try {
    await fs.writeFile(
      manifestPath,
      buildConfigMap(
        registryHost,
        registryHostFromContainerRuntime,
        registryHostFromClusterNetwork,
        help
      ),
      "utf-8"
    );
    await withRetry(
      () =>
        runProducerCommand(owner, ["kubectl", "apply", "-f", manifestPath], {
          ...(kubeconfigPath ? { env: { KUBECONFIG: kubeconfigPath } } : {}),
          timeoutMs: KUBECTL_APPLY_TIMEOUT_MS,
          kind: "registry-advertise",
          effect: "hook",
        }),
      retry
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
};
