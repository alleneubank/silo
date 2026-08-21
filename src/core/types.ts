export type PortConfigValue = number | "random";

export interface SiloConfig {
  version: 1;
  prefix?: string;
  output?: string;
  ports: Record<string, PortConfigValue>;
  hosts?: Record<string, string>;
  urls?: Record<string, string>;
  k3d?: K3dConfig;
  hooks?: LifecycleHooks;
  profiles?: Record<string, ProfileConfig>;
  registry?: RegistryConfig;
}

export interface K3dConfig {
  enabled: boolean;
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
  hooks?: Partial<LifecycleHooks>;
  append?: ProfileAppendConfig;
  registry?: RegistryConfig;
}

export interface ResolvedConfig {
  version: 1;
  prefix: string;
  output: string;
  ports: Record<string, PortConfigValue>;
  portOrder: string[];
  hosts: Record<string, string>;
  hostOrder: string[];
  urls: Record<string, string>;
  urlOrder: string[];
  k3d: K3dConfig | undefined;
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

/**
 * A Tilt stack that `silo up --force` started a parallel stack alongside.
 *
 * The lockfile tracks one instance, so the pid it was holding would otherwise
 * be overwritten and the stack left with no record anywhere. Keeping the ports
 * it owns is what lets `silo status` say which stack answers on which port.
 */
export interface DisownedTilt {
  pid: number;
  name: string;
  ports: Record<string, number>;
  startedAt?: string | undefined;
  disownedAt: string;
}

export interface InstanceState {
  name: string;
  profile?: string | undefined;
  ports: Record<string, number>;
  identity: InstanceIdentity;
  createdAt: string;
  k3dClusterCreated: boolean;
  tiltPid?: number | undefined;
  tiltStartedAt?: string | undefined;
  disownedTilts?: DisownedTilt[] | undefined;
}

export interface Lockfile {
  version: 1;
  generatedAt: string;
  instance: InstanceState;
}

export type IdentityVars = Record<string, string> & {
  name: string;
  prefix: string;
  WORKSPACE_NAME: string;
  COMPOSE_PROJECT_NAME: string;
};
