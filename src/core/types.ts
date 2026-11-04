import type { BRAND } from "zod";
import type { z } from "zod";
import type { InstanceStateSchema } from "./lease_types";
import type { LockfileSchema } from "./lockfile";

export type PortConfigValue = number | "random";
export type ProjectRelativePath = string & BRAND<"ProjectRelativePath">;

export interface TiltConfig {
  webMode?: "prod";
}

export interface SiloConfig {
  version: 1;
  prefix?: string;
  output?: ProjectRelativePath;
  ports: Record<string, PortConfigValue>;
  hosts?: Record<string, string>;
  urls?: Record<string, string>;
  k3d?: K3dConfig;
  tilt?: TiltConfig;
  hooks?: LifecycleHooks;
  profiles?: Record<string, ProfileConfig>;
  registry?: RegistryConfig;
}

export interface K3dConfig {
  enabled: boolean;
  kubeconfigPath?: ProjectRelativePath;
  args?: string[];
  registry?: {
    enabled: boolean;
    advertise?: boolean;
    host?: string;
    hostFromContainerRuntime?: string;
    hostFromClusterNetwork?: string;
    help?: string;
  };
}

export interface LifecycleHooks {
  "pre-up"?: string[];
  "post-up"?: string[];
  "pre-down"?: string[];
  "post-down"?: string[];
}

export interface ProfileAppendConfig {
  hooks?: Partial<LifecycleHooks>;
  k3d?: {
    args?: string[];
  };
}

export interface RegistryConfig {
  advertise?: boolean;
  host?: string;
  hostFromContainerRuntime?: string;
  hostFromClusterNetwork?: string;
  help?: string;
}

export interface ProfileConfig {
  ports?: Record<string, PortConfigValue>;
  hosts?: Record<string, string>;
  urls?: Record<string, string>;
  k3d?: Partial<K3dConfig>;
  tilt?: TiltConfig;
  hooks?: Partial<LifecycleHooks>;
  append?: ProfileAppendConfig;
  registry?: RegistryConfig;
}

export interface ResolvedConfig {
  version: 1;
  prefix: string;
  output: ProjectRelativePath;
  ports: Record<string, PortConfigValue>;
  portOrder: string[];
  hosts: Record<string, string>;
  hostOrder: string[];
  urls: Record<string, string>;
  urlOrder: string[];
  k3d: K3dConfig | undefined;
  tilt?: TiltConfig | undefined;
  hooks: LifecycleHooks;
  profiles: Record<string, ProfileConfig> | undefined;
  registry: RegistryConfig | undefined;
  configPath: string;
  projectRoot: string;
}

export interface InstanceIdentity {
  name: string;
  prefix: string;
  composeName: string;
  dockerNetwork: string;
  volumePrefix: string;
  containerPrefix: string;
  hosts: Record<string, string>;
  k3dClusterName?: string | undefined;
  k3dRegistryName?: string | undefined;
  kubeconfigPath?: string | undefined;
}

export type InstanceState = z.infer<typeof InstanceStateSchema>;
export type Lockfile = z.infer<typeof LockfileSchema>;

export type IdentityVars = Record<string, string> & {
  name: string;
  prefix: string;
  WORKSPACE_NAME: string;
  COMPOSE_PROJECT_NAME: string;
};
