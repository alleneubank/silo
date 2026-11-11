import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { ProjectOperation } from "./lease_store";
import { digest, processAbsent } from "./lease_store";
import { parseConfig } from "./config";
import { buildInstanceState } from "./instance";
import { allocatePorts, type PortAllocationEvent } from "./ports";
import { logPortAllocations } from "../utils/logger";
import { generateName, sanitizeName } from "./name";
import { applyProfile, resolveAndApplyProfile } from "./profile";
import type { FileRole, FileTarget } from "./file_target";
import { resourceClaims } from "./resource_claims";
import { assertNamesAvailable, captureEngine } from "../backends/ownership";
import { validateK3dArgs } from "../backends/k3d";
import { SiloError } from "../utils/errors";
import type { Allocation } from "./lease_types";
import type { Lockfile, PortConfigValue, ResolvedConfig } from "./types";

const MAX_NAME_ATTEMPTS = 32;
const MAX_PORT_ATTEMPTS = 65535 - 49152 + 1;
const MAX_CONFIG_BYTES = 1024 * 1024;

export const storedConfig = (allocation: Allocation): ResolvedConfig => {
  const base = parseConfig(allocation.configSource, allocation.configPath);
  return allocation.state.profile ? applyProfile(base, allocation.state.profile) : base;
};

const fileTargets = (owner: ProjectOperation, config: ResolvedConfig, allocation: Allocation): { role: FileRole; target: FileTarget }[] => {
  const targets: { role: FileRole; target: FileTarget }[] = [
    { role: "env", target: owner.prepareTarget(owner.root, config.output, "env") },
    { role: "lock", target: owner.prepareTarget(owner.root, ".silo.lock", "lock") },
    { role: "config", target: owner.prepareTarget(owner.root, path.relative(owner.root, config.configPath), "config") },
  ];
  if (allocation.state.identity.kubeconfigPath) {
    const base = config.k3d?.kubeconfigPath === undefined ? os.homedir() : owner.root;
    const relative = config.k3d?.kubeconfigPath ?? path.relative(base, allocation.state.identity.kubeconfigPath);
    targets.push({ role: "kubeconfig", target: owner.prepareTarget(base, relative, "kubeconfig") });
  }
  return targets;
};

/** The only allocation path used by env, up and ci. Probes never confer authority. */
export const allocateProject = async (owner: ProjectOperation, nameArg: string | undefined, options: {
  config: string; force: boolean; profile: string | undefined;
}, validateConfig?: (config: ResolvedConfig) => void): Promise<Allocation> => {
  const configPath = path.join(owner.root, path.basename(path.resolve(options.config)));
  const bytes = readFileSync(configPath);
  if (bytes.byteLength > MAX_CONFIG_BYTES) throw new SiloError("silo.toml exceeds 1 MiB", "INVALID_CONFIG");
  const configSource = bytes.toString("utf8");
  const baseConfig = parseConfig(configSource, configPath);
  const current = owner.current();
  const snapshot: Lockfile | null = current ? {
    version: 2, projectId: owner.projectId, generation: owner.generation,
    generatedAt: current.allocation.state.createdAt, instance: current.allocation.state,
  } : null;
  const { config, profileName } = resolveAndApplyProfile({ baseConfig, profileFlag: options.profile, lockfile: snapshot, force: options.force });
  validateConfig?.(config);
  const name = nameArg ? sanitizeName(nameArg) : current?.allocation.state.name ?? generateName(owner.root);
  const fingerprint = digest(JSON.stringify({ configSource, name, profile: profileName ?? null, home: config.k3d?.enabled && config.k3d.kubeconfigPath === undefined ? os.homedir() : null }));
  const engine = await captureEngine(owner);
  if (current) {
    if (current.allocation.engine?.id !== engine.id || current.allocation.engine.endpoint !== engine.endpoint) {
      throw new SiloError("ENGINE_CHANGED: Docker endpoint or identity changed; reconcile the original engine first", "ENGINE_CHANGED");
    }
    if (!options.force && fingerprint === current.allocation.fingerprint) return current.allocation;
    const live = owner.launches().some(l =>
      (l.supervisorPid !== null && !processAbsent(l.supervisorPid)) || (l.groupId !== null && !processAbsent(-l.groupId)),
    );
    if (live || current.phase === "running" || current.phase === "retained" || current.phase === "cleanup-required") {
      throw new SiloError("ALREADY_RUNNING: --force cannot disown or retarget a live, retained or uncertain generation. Run down and reconcile first; parallel stacks need separate roots and names.", "ALREADY_RUNNING");
    }
    if (!options.force) throw new SiloError("CONFIG_CHANGED: stop/reconcile, then use --force for a stopped generation or clean before changing output paths", "CONFIG_CHANGED");
  }
  const portsConfig: Record<string, PortConfigValue> = {
    ...config.ports,
    ...(config.k3d?.enabled && config.ports.K3D_API_PORT === undefined ? { K3D_API_PORT: "random" as const } : {}),
  };
  const generated = nameArg === undefined && current === null;
  let chosenName = name;
  for (let nameAttempt = 0; nameAttempt < MAX_NAME_ATTEMPTS; nameAttempt++) {
    for (let portAttempt = 0; portAttempt < MAX_PORT_ATTEMPTS; portAttempt++) {
      const events: PortAllocationEvent[] = [];
      const ports = await allocatePorts({ ports: portsConfig, order: Object.keys(portsConfig), lockfilePorts: undefined, force: options.force, excludedPorts: owner.excludedPorts(), onEvent: event => events.push(event) });
      const rendered = buildInstanceState({ config, name: chosenName, profile: profileName, ports });
      const allocation: Allocation = {
        ...rendered, configPath, configSource,
        fingerprint: chosenName === name ? fingerprint : digest(JSON.stringify({ configSource, name: chosenName, profile: profileName ?? null, home: config.k3d?.enabled && config.k3d.kubeconfigPath === undefined ? os.homedir() : null })),
        engine,
      };
      validateK3dArgs(allocation.k3dArgs, allocation.state.ports);
      const claims = resourceClaims(allocation.state, config);
      try {
        await assertNamesAvailable(claims, owner, owner.resources());
        const targets = fileTargets(owner, config, allocation);
        await owner.allocate(allocation, claims, targets);
        logPortAllocations(events);
        return allocation;
      } catch (error) {
        if (error instanceof SiloError && error.code === "PORT_CLAIM_CONFLICT") continue;
        if (generated && error instanceof SiloError && error.code === "NAME_CONFLICT") break;
        throw error;
      }
    }
    if (!generated) throw new SiloError("Port claim search exhausted", "PORTS_EXHAUSTED");
    chosenName = generateName(owner.root);
  }
  throw new SiloError("Generated name search exhausted; choose an explicit name", "NAME_CONFLICT");
};
