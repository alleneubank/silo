import { createSocket } from "node:dgram";
import {
  EPHEMERAL_PORT_END,
  EPHEMERAL_PORT_START,
  PORT_CHECK_TIMEOUT_MS,
} from "./constants";
import { checkListenerAbsent } from "./socket_listeners";
import { withTimeout, type Cancellable } from "../utils/timeout";
import { SiloError } from "../utils/errors";
import type { PortConfigValue } from "./types";

const isPortInRange = (port: number): boolean => port >= 1 && port <= 65535;

export type PortCheckFn = (port: number) => Promise<boolean>;

// Hostnames to check — a port is only free if binding succeeds on all of them.
// 0.0.0.0 catches wildcard listeners; 127.0.0.1 catches loopback-only listeners
// (e.g. Tilt). Checking only 0.0.0.0 misses ports bound exclusively to 127.0.0.1,
// which causes "address already in use" when another process binds loopback.
const PORT_CHECK_HOSTNAMES = ["0.0.0.0", "127.0.0.1", "::", "::1"] as const;

const unsupportedIPv6 = (hostname: string, error: unknown): boolean =>
  hostname.includes(":") && error instanceof Error && "code" in error &&
  ["EAFNOSUPPORT", "EPROTONOSUPPORT", "EADDRNOTAVAIL"].includes(String(error.code));

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
  } catch (error) {
    return unsupportedIPv6(hostname, error);
  }
};

const bindUdp = (hostname: string, port: number): Cancellable<boolean> => {
  const socket = createSocket(hostname.includes(":") ? "udp6" : "udp4");
  let finish: (free: boolean) => void;
  let closed: Promise<void> | undefined;
  const result = new Promise<boolean>(resolve => {
    finish = resolve;
    socket.once("error", error => resolve(unsupportedIPv6(hostname, error)));
    socket.bind(port, hostname, () => resolve(true));
  });
  const cancel = (): Promise<void> => {
    closed ??= new Promise<void>((resolve, reject) => {
      try { socket.close(resolve); }
      catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ERR_SOCKET_DGRAM_NOT_RUNNING") resolve();
        else reject(error);
      }
    });
    finish(false);
    return closed;
  };
  return { result, cancel };
};

export const checkPortFree: PortCheckFn = async (port: number): Promise<boolean> => {
  let cancelled = false;
  let udp: Cancellable<boolean> | undefined;
  const attempt = async (): Promise<boolean> => {
    for (const hostname of PORT_CHECK_HOSTNAMES) {
      if (cancelled) throw new SiloError("Port check cancelled", "INTERRUPTED");
      if (!(await tryBind(hostname, port))) return false;
      udp = bindUdp(hostname, port);
      try { if (!(await udp.result)) return false; }
      finally { await udp.cancel(); udp = undefined; }
    }
    return true;
  };
  return withTimeout({ result: attempt(), cancel: async () => {
    cancelled = true;
    await udp?.cancel();
  } }, PORT_CHECK_TIMEOUT_MS, "port check " + port);
};

/**
 * Retirement proof: true only when no TCP listener and no peerless UDP socket
 * remains on the port, on any address. Outgoing connections do not count.
 */
export const checkPortListenerAbsent: PortCheckFn = checkListenerAbsent;

export type PortAllocationSource = "lockfile" | "default" | "ephemeral";

export type PortAllocationEvent = {
  key: string;
  requestedDefault: PortConfigValue;
  requestedLock?: number;
  assigned: number;
  source: PortAllocationSource;
};

const EPHEMERAL_RANGE_SIZE = EPHEMERAL_PORT_END - EPHEMERAL_PORT_START + 1;

// Scan the ephemeral range starting at startAt, wrapping back to
// EPHEMERAL_PORT_START after hitting EPHEMERAL_PORT_END. Skips ports in
// `used` (already-allocated in this call) and `excluded` (owned by other
// silo generations, per their committed claims).
const findEphemeralPort = async (params: {
  used: Set<number>;
  excluded: Set<number>;
  startAt: number;
  isPortFree: PortCheckFn;
}): Promise<number> => {
  const { used, excluded, startAt, isPortFree } = params;
  for (let offset = 0; offset < EPHEMERAL_RANGE_SIZE; offset += 1) {
    const port =
      EPHEMERAL_PORT_START +
      ((startAt - EPHEMERAL_PORT_START + offset) % EPHEMERAL_RANGE_SIZE);
    if (used.has(port) || excluded.has(port)) {
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
  // Candidate selection only: the lease transaction decides final ownership.
  excludedPorts?: Set<number>;
  onEvent?: (event: PortAllocationEvent) => void;
  isPortFree?: PortCheckFn;
}): Promise<Record<string, number>> => {
  const { ports, order, lockfilePorts, force, excludedPorts, onEvent, isPortFree } = params;
  const portFree = isPortFree ?? checkPortFree;
  const excluded = excludedPorts ?? new Set<number>();
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
      if (used.has(candidate.port) || excluded.has(candidate.port)) {
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
        excluded,
        startAt: nextEphemeral,
        isPortFree: portFree,
      });
      // Advance past the assigned port, wrapping when we fall off the end.
      nextEphemeral =
        assigned >= EPHEMERAL_PORT_END ? EPHEMERAL_PORT_START : assigned + 1;
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
