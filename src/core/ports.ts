import { createSocket } from "node:dgram";
import { PORT_CHECK_TIMEOUT_MS } from "./constants";
import { fallbackPorts, insideRange, kernelEphemeralRange, type PortRange } from "./port_range";
import { checkListenerAbsent } from "./socket_listeners";
import { withTimeout, type Cancellable } from "../utils/timeout";
import { SiloError } from "../utils/errors";
import { operationSignal } from "../utils/interrupt";
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
  } }, PORT_CHECK_TIMEOUT_MS, "port check " + port, operationSignal());
};

/**
 * Retirement proof: true only when no TCP listener and no peerless UDP socket
 * remains on the port, on any address. Outgoing connections do not count.
 */
export const checkPortListenerAbsent: PortCheckFn = checkListenerAbsent;

export type PortAllocationSource = "lockfile" | "default" | "fallback";

export type PortAllocationEvent = {
  key: string;
  requestedDefault: PortConfigValue;
  requestedLock?: number;
  assigned: number;
  source: PortAllocationSource;
};

/** Where new ports may come from: never inside the kernel's live ephemeral range. */
export type PortSpace = {
  ephemeral: PortRange;
  // Ordered fallback candidates, all outside `ephemeral`.
  fallback: readonly number[];
};

export const livePortSpace = (): PortSpace => {
  const ephemeral = kernelEphemeralRange();
  return { ephemeral, fallback: fallbackPorts(ephemeral) };
};

// Scan the fallback candidates from cursor `startAt`, wrapping once. Skips
// ports in `used` (already allocated in this call) and `excluded` (owned by
// other silo generations or slot runs, per their committed claims).
const findFallbackPort = async (params: {
  space: PortSpace;
  used: Set<number>;
  excluded: Set<number>;
  startAt: number;
  isPortFree: PortCheckFn;
}): Promise<{ port: number; index: number }> => {
  const { space, used, excluded, startAt, isPortFree } = params;
  const candidates = space.fallback;
  for (let offset = 0; offset < candidates.length; offset += 1) {
    const index = (startAt + offset) % candidates.length;
    const port = candidates[index]!;
    if (used.has(port) || excluded.has(port)) {
      continue;
    }
    if (await isPortFree(port)) {
      return { port, index };
    }
  }
  throw new SiloError("No free ports available outside the ephemeral range", "PORTS_EXHAUSTED");
};

export const allocatePorts = async (params: {
  ports: Record<string, PortConfigValue>;
  order: string[];
  lockfilePorts: Record<string, number> | undefined;
  force: boolean;
  space: PortSpace;
  // Candidate selection only: the lease transaction decides final ownership.
  excludedPorts?: Set<number>;
  onEvent?: (event: PortAllocationEvent) => void;
  isPortFree?: PortCheckFn;
}): Promise<Record<string, number>> => {
  const { ports, order, lockfilePorts, force, space, excludedPorts, onEvent, isPortFree } = params;
  const portFree = isPortFree ?? checkPortFree;
  const excluded = excludedPorts ?? new Set<number>();
  const allocated: Record<string, number> = {};
  const used = new Set<number>();
  let nextFallback = 0;

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
      // A declared port inside the ephemeral range is never handed out: the
      // kernel can take it after the probe passes.
      if (used.has(candidate.port) || excluded.has(candidate.port) || insideRange(candidate.port, space.ephemeral)) {
        continue;
      }
      if (await portFree(candidate.port)) {
        assigned = candidate.port;
        source = candidate.source;
        break;
      }
    }

    if (!assigned) {
      const found = await findFallbackPort({
        space,
        used,
        excluded,
        startAt: nextFallback,
        isPortFree: portFree,
      });
      assigned = found.port;
      nextFallback = (found.index + 1) % space.fallback.length;
      source = "fallback";
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

/**
 * A contiguous block of `size` ports, all fallback candidates (so outside the
 * ephemeral range), none excluded, each passing the native probe. Probes are
 * hints; the store transaction grants the block.
 */
export const findPortBlock = async (params: {
  size: number;
  space: PortSpace;
  excluded: ReadonlySet<number>;
  isPortFree?: PortCheckFn;
}): Promise<number[]> => {
  const { size, space, excluded } = params;
  const portFree = params.isPortFree ?? checkPortFree;
  const candidates = new Set(space.fallback);
  const usable = (port: number) => candidates.has(port) && !excluded.has(port);
  for (const base of space.fallback) {
    const block = Array.from({ length: size }, (_, index) => base + index);
    if (!block.every(usable)) continue;
    let free = true;
    for (const port of block) {
      if (!(await portFree(port))) { free = false; break; }
    }
    if (free) return block;
  }
  throw new SiloError(`PORTS_EXHAUSTED: no free block of ${size} ports outside the ephemeral range`, "PORTS_EXHAUSTED");
};
