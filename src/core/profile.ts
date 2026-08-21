import type {
  K3dConfig,
  LifecycleHooks,
  Lockfile,
  ProfileConfig,
  RegistryConfig,
  ResolvedConfig,
} from "./types";
import { SiloError } from "../utils/errors";
import { logger } from "../utils/logger";

type ProfileSource = "flag" | "env" | "lockfile" | "none";

interface ProfileResolution {
  name: string | undefined;
  source: ProfileSource;
}

const HOOK_KEYS = ["pre-up", "post-up", "pre-down", "post-down"] as const;

const normalizeProfileName = (value?: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** The profile the caller asked for explicitly: `--profile` first, then env. */
export const resolveExplicitProfile = (
  profileFlag: string | undefined
): string | undefined =>
  normalizeProfileName(profileFlag) ?? normalizeProfileName(process.env.SILO_PROFILE);

const resolveProfileName = (params: {
  profileFlag: string | undefined;
  envProfile: string | undefined;
  lockfileProfile: string | undefined;
  profiles: Record<string, ProfileConfig> | undefined;
}): ProfileResolution => {
  const flagProfile = normalizeProfileName(params.profileFlag);
  const envProfile = normalizeProfileName(params.envProfile);
  const lockfileProfile = normalizeProfileName(params.lockfileProfile);

  const name = flagProfile ?? envProfile ?? lockfileProfile;
  const source: ProfileSource = flagProfile
    ? "flag"
    : envProfile
    ? "env"
    : lockfileProfile
    ? "lockfile"
    : "none";

  if (!name) {
    return { name: undefined, source };
  }

  const profiles = params.profiles;
  if (!profiles || Object.keys(profiles).length === 0) {
    throw new SiloError("No profiles defined in config", "PROFILE_MISSING");
  }
  if (!profiles[name]) {
    throw new SiloError(`Unknown profile: ${name}`, "PROFILE_NOT_FOUND");
  }

  return { name, source };
};

export const resolveAndApplyProfile = (params: {
  baseConfig: ResolvedConfig;
  profileFlag: string | undefined;
  lockfile: Lockfile | null;
  force: boolean;
}): { config: ResolvedConfig; profileName: string | undefined } => {
  const { baseConfig, profileFlag, lockfile, force } = params;

  const explicitProfile = resolveExplicitProfile(profileFlag);
  const lockfileProfileForResolution =
    force && !explicitProfile ? undefined : lockfile?.instance?.profile;

  const { name: profileName, source: profileSource } = resolveProfileName({
    profileFlag,
    envProfile: process.env.SILO_PROFILE,
    lockfileProfile: lockfileProfileForResolution,
    profiles: baseConfig.profiles,
  });

  const currentProfile = lockfile?.instance?.profile;
  if (lockfile && currentProfile !== profileName) {
    if (!force) {
      const requested = profileName ?? "base";
      const current = currentProfile ?? "base";
      throw new SiloError(
        `Profile change requires --force (current: ${current}, requested: ${requested})`,
        "PROFILE_SWITCH"
      );
    }
    if (currentProfile && !profileName) {
      logger.info("Cleared profile, using base config");
    }
  }

  if (profileSource === "lockfile" && profileName) {
    logger.info(`Reusing profile '${profileName}' from lockfile`);
  }

  const config = profileName ? applyProfile(baseConfig, profileName) : baseConfig;
  if (profileName) {
    logger.info(`Profile: ${profileName}`);
  }

  return { config, profileName };
};

const mergeRecordWithOrder = <T>(
  base: Record<string, T>,
  baseOrder: string[],
  override?: Record<string, T>
): { merged: Record<string, T>; order: string[] } => {
  if (!override || Object.keys(override).length === 0) {
    return { merged: { ...base }, order: [...baseOrder] };
  }
  const merged = { ...base, ...override };
  const overrideOrder = Object.keys(override);
  const newKeys = overrideOrder.filter((key) => !baseOrder.includes(key));
  return { merged, order: [...baseOrder, ...newKeys] };
};

const mergeHooks = (
  base: LifecycleHooks,
  override?: Partial<LifecycleHooks>,
  append?: Partial<LifecycleHooks>
): LifecycleHooks => {
  const merged: LifecycleHooks = override ? { ...base, ...override } : { ...base };
  if (!append) {
    return merged;
  }

  const result: LifecycleHooks = { ...merged };
  HOOK_KEYS.forEach((key) => {
    const appendHooks = append[key];
    if (appendHooks && appendHooks.length > 0) {
      const current = merged[key] ?? [];
      result[key] = [...current, ...appendHooks];
    }
  });

  return result;
};

const mergeK3dConfig = (params: {
  base: K3dConfig | undefined;
  override: Partial<K3dConfig> | undefined;
  appendArgs: string[] | undefined;
}): K3dConfig | undefined => {
  const { base, override, appendArgs } = params;
  if (!base && !override) {
    return undefined;
  }

  const enabled = override?.enabled ?? base?.enabled;
  if (enabled === undefined) {
    throw new SiloError("k3d.enabled must be defined when using profiles", "INVALID_CONFIG");
  }

  const registry = override?.registry
    ? { ...base?.registry, ...override.registry }
    : base?.registry;

  const baseArgs = override?.args ?? base?.args;
  const mergedArgs = appendArgs
    ? [...(baseArgs ?? []), ...appendArgs]
    : baseArgs;

  return {
    enabled,
    ...(mergedArgs ? { args: mergedArgs } : {}),
    ...(registry ? { registry } : {}),
  };
};

const mergeRegistryConfig = (
  base: RegistryConfig | undefined,
  override: RegistryConfig | undefined
): RegistryConfig | undefined => {
  if (!base && !override) {
    return undefined;
  }
  if (!override) {
    return base ? { ...base } : undefined;
  }
  if (!base) {
    return { ...override };
  }
  return { ...base, ...override };
};

export const applyProfile = (config: ResolvedConfig, profileName: string): ResolvedConfig => {
  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new SiloError(`Unknown profile: ${profileName}`, "PROFILE_NOT_FOUND");
  }

  const { merged: ports, order: portOrder } = mergeRecordWithOrder(
    config.ports,
    config.portOrder,
    profile.ports
  );

  const { merged: hosts, order: hostOrder } = mergeRecordWithOrder(
    config.hosts,
    config.hostOrder,
    profile.hosts
  );

  const { merged: urls, order: urlOrder } = mergeRecordWithOrder(
    config.urls,
    config.urlOrder,
    profile.urls
  );

  const hooks = mergeHooks(config.hooks, profile.hooks, profile.append?.hooks);
  const k3d = mergeK3dConfig({
    base: config.k3d,
    override: profile.k3d,
    appendArgs: profile.append?.k3d?.args,
  });
  const registry = mergeRegistryConfig(config.registry, profile.registry);

  return {
    ...config,
    ports,
    portOrder,
    hosts,
    hostOrder,
    urls,
    urlOrder,
    hooks,
    k3d,
    registry,
  };
};
