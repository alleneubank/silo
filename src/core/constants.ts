export const CONFIG_VERSION = 1 as const;
export const DEFAULT_PREFIX = "localnet";
export const DEFAULT_OUTPUT = ".localnet.env";
export const DEFAULT_HOSTS = { APP_HOST: "${name}.localhost" } as const;
export const DEFAULT_URLS: Record<string, string> = {};

export const LOCKFILE_NAME = ".silo.lock";
// Held only while a `silo up` is starting, to serialize the window where the
// lockfile cannot yet name the Tilt being started.
export const STARTUP_CLAIM_NAME = ".silo.startup";
// The pid of the holding process decides staleness. This bound only resolves a
// claim whose pid was recycled by an unrelated process, so it is far longer
// than any startup can run — hooks alone may take HOOK_TIMEOUT_MS each.
export const STARTUP_CLAIM_TTL_MS = 86400000;

export const EPHEMERAL_PORT_START = 49152;
export const EPHEMERAL_PORT_END = 65535;

export const PORT_CHECK_TIMEOUT_MS = 100;
export const TOOL_CHECK_TIMEOUT_MS = 2000;

// Bare `tilt up` outlives silo whenever silo dies without running its signal
// handlers (SIGKILL, SIGHUP, crash): Tilt reparents to init and keeps holding
// the instance's allocated ports. janitor watches its parent and drains the
// process group when silo goes away.
export const TILT_SUPERVISOR_BIN = "janitor";
// Larger than janitor's CLI default: dev servers need a beat to release ports
// and flush on SIGTERM before the supervisor escalates to SIGKILL.
export const TILT_DRAIN_GRACE_MS = 5000;
export const HOOK_TIMEOUT_MS = 300000;
export const K3D_CREATE_TIMEOUT_MS = 300000;
export const K3D_DELETE_TIMEOUT_MS = 180000;
export const K3D_LIST_TIMEOUT_MS = 5000;
export const DOCKER_PS_TIMEOUT_MS = 5000;
export const DOCKER_PORT_TIMEOUT_MS = 5000;
export const K3D_CLUSTER_NAME_MAX_LENGTH = 32;
export const K3D_CLUSTER_NAME_HASH_LENGTH = 8;
export const K3D_CLUSTER_NAME_SUFFIX_LENGTH = 6;
export const KUBECTL_APPLY_TIMEOUT_MS = 10000;
export const KUBECTL_GET_TIMEOUT_MS = 5000;
export const PROCESS_CHECK_TIMEOUT_MS = 2000;
export const TILT_STOP_TIMEOUT_MS = 10000;
export const TILT_DOWN_TIMEOUT_MS = 60000;
export const TILT_CI_TIMEOUT_MS = 7200000;

export const REGISTRY_RESOLVE_RETRY_COUNT = 5;
export const REGISTRY_RESOLVE_RETRY_BASE_DELAY_MS = 200;
export const REGISTRY_RESOLVE_RETRY_MAX_DELAY_MS = 2000;
export const REGISTRY_ADVERTISE_RETRY_COUNT = 5;
export const REGISTRY_ADVERTISE_RETRY_BASE_DELAY_MS = 200;
export const REGISTRY_ADVERTISE_RETRY_MAX_DELAY_MS = 2000;
