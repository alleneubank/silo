import {
  EPHEMERAL_PORT_END,
  EPHEMERAL_PORT_START,
  PORT_CHECK_TIMEOUT_MS,
} from "./constants";
import { withTimeout } from "../utils/timeout";
import { SiloError } from "../utils/errors";
import type { PortConfigValue } from "./types";

const isPortInRange = (port: number): boolean => port >= 1 && port <= 65535;

type PortCheckFn = (port: number) => Promise<boolean>;

// Hostnames to check — a port is only free if binding succeeds on all of them.
// 0.0.0.0 catches wildcard listeners; 127.0.0.1 catches loopback-only listeners
// (e.g. Tilt). Checking only 0.0.0.0 misses ports bound exclusively to 127.0.0.1,
// which causes "address already in use" when another process binds loopback.
const PORT_CHECK_HOSTNAMES = ["0.0.0.0", "127.0.0.1"] as const;

const tryBind = async (hostname: string, port: number): Promise<boolean> => {
  try {
    const server = Bun.listen({
      hostname,
      port,
      socket: {
        data() {},
      },
    });
    server.stop();
    return true;
  } catch {
    return false;
  }
};

const checkPortFree: PortCheckFn = async (port: number): Promise<boolean> => {
  const attempt = async (): Promise<boolean> => {
    for (const hostname of PORT_CHECK_HOSTNAMES) {
      if (!(await tryBind(hostname, port))) {
        return false;
      }
    }
    return true;
  };

  return await withTimeout(attempt(), PORT_CHECK_TIMEOUT_MS, `port check ${port}`);
};

export type PortAllocationSource = "lockfile" | "default" | "ephemeral";

export type PortAllocationEvent = {
  key: string;
  requestedDefault: PortConfigValue;
  requestedLock?: number;
  assigned: number;
  source: PortAllocationSource;
};

const findEphemeralPort = async (params: {
  used: Set<number>;
  startAt: number;
  isPortFree: PortCheckFn;
}): Promise<number> => {
  const { used, startAt, isPortFree } = params;
  for (let port = startAt; port <= EPHEMERAL_PORT_END; port += 1) {
    if (used.has(port)) {
      continue;
    }
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new SiloError("No free ports available in ephemeral range", "PORTS_EXHAUSTED");
};

export const allocatePorts = async (params: {
  ports: Record<string, PortConfigValue>;
  order: string[];
  lockfilePorts: Record<string, number> | undefined;
  force: boolean;
  onEvent?: (event: PortAllocationEvent) => void;
  isPortFree?: PortCheckFn;
}): Promise<Record<string, number>> => {
  const { ports, order, lockfilePorts, force, onEvent, isPortFree } = params;
  const portFree = isPortFree ?? checkPortFree;
  const allocated: Record<string, number> = {};
  const used = new Set<number>();
  let nextEphemeral = EPHEMERAL_PORT_START;

  for (const key of order) {
    const defaultPort = ports[key];
    if (defaultPort === undefined) {
      throw new SiloError(`Invalid port for ${key}: ${defaultPort}`, "INVALID_PORT");
    }
    if (defaultPort !== "random" && !isPortInRange(defaultPort)) {
      throw new SiloError(`Invalid port for ${key}: ${defaultPort}`, "INVALID_PORT");
    }

    const candidates: Array<{ port: number; source: PortAllocationSource }> = [];
    const lockPort = !force ? lockfilePorts?.[key] : undefined;
    if (lockPort && isPortInRange(lockPort)) {
      candidates.push({ port: lockPort, source: "lockfile" });
    }
    if (defaultPort !== "random") {
      candidates.push({ port: defaultPort, source: "default" });
    }

    let assigned: number | undefined;
    let source: PortAllocationSource = "default";
    for (const candidate of candidates) {
      if (used.has(candidate.port)) {
        continue;
      }
      if (await portFree(candidate.port)) {
        assigned = candidate.port;
        source = candidate.source;
        break;
      }
    }

    if (!assigned) {
      assigned = await findEphemeralPort({
        used,
        startAt: nextEphemeral,
        isPortFree: portFree,
      });
      nextEphemeral = assigned + 1;
      source = "ephemeral";
    }

    allocated[key] = assigned;
    used.add(assigned);
    if (onEvent) {
      const event: PortAllocationEvent = {
        key,
        requestedDefault: defaultPort,
        assigned,
        source,
        ...(lockPort && isPortInRange(lockPort) ? { requestedLock: lockPort } : {}),
      };
      onEvent(event);
    }
  }

  return allocated;
};
