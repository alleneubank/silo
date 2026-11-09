import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EPHEMERAL_PORT_END,
  EPHEMERAL_PORT_START,
  PORT_CHECK_TIMEOUT_MS,
  SOCKET_TABLE_TIMEOUT_MS,
} from "./constants";
import { withTimeout } from "../utils/timeout";
import { SiloError } from "../utils/errors";
import type { PortConfigValue } from "./types";

const isPortInRange = (port: number): boolean => port >= 1 && port <= 65535;

export type PortCheckFn = (port: number) => Promise<boolean>;

// Hostnames to check — a port is only free if binding succeeds on all of them.
// 0.0.0.0 catches wildcard listeners; 127.0.0.1 catches loopback-only listeners
// (e.g. Tilt). Checking only 0.0.0.0 misses ports bound exclusively to 127.0.0.1,
// which causes "address already in use" when another process binds loopback.
const PORT_CHECK_HOSTNAMES = ["0.0.0.0", "127.0.0.1", "::", "::1"] as const;

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
    if (hostname.includes(":") && error instanceof Error && "code" in error &&
      ["EAFNOSUPPORT", "EPROTONOSUPPORT", "EADDRNOTAVAIL"].includes(String(error.code))) return true;
    return false;
  }
};

export const checkPortFree: PortCheckFn = async (port: number): Promise<boolean> => {
  const attempt = async (): Promise<boolean> => {
    for (const hostname of PORT_CHECK_HOSTNAMES) {
      if (!(await tryBind(hostname, port))) {
        return false;
      }
      try {
        const udp = await Bun.udpSocket({ hostname, port });
        udp.close();
      } catch (error) {
        const unsupported = hostname.includes(":") && error instanceof Error && "code" in error &&
          ["EAFNOSUPPORT", "EPROTONOSUPPORT", "EADDRNOTAVAIL"].includes(String(error.code));
        if (!unsupported) return false;
      }
    }
    return true;
  };

  return await withTimeout(attempt(), PORT_CHECK_TIMEOUT_MS, `port check ${port}`);
};

// On Linux a bind conflicts with every socket holding the port, including an
// outgoing connection's kernel-chosen local port, so a failed bind cannot show
// that a listener remains. The kernel's socket tables can: TCP state 0A is
// LISTEN, and a UDP socket without a peer reports 07. The TCP tables list
// listening and connected sockets; a socket that is only bound accepts nothing.
// The IPv6 tables are absent when the kernel runs without IPv6.
const LINUX_SOCKET_TABLES = [
  { path: "/proc/net/tcp", acceptingState: "0A", required: true },
  { path: "/proc/net/udp", acceptingState: "07", required: true },
  { path: "/proc/net/tcp6", acceptingState: "0A", required: false },
  { path: "/proc/net/udp6", acceptingState: "07", required: false },
] as const;

type SocketTable = (typeof LINUX_SOCKET_TABLES)[number];

const readSocketTable = async (table: SocketTable): Promise<string | null> => {
  try {
    return await readFile(table.path, "utf8");
  } catch (error) {
    const absent = error instanceof Error && "code" in error && error.code === "ENOENT";
    if (absent && !table.required) return null;
    throw error;
  }
};

// Rows: `sl local_address rem_address st ...`, addresses as `HEXADDR:HEXPORT`.
const hasAcceptingSocket = (table: SocketTable, text: string, port: number): boolean => {
  const [header = "", ...rows] = text.split("\n");
  const columns = header.trim().split(/\s+/);
  assert(columns[1] === "local_address" && columns[3] === "st", `${table.path} layout: ${header}`);
  return rows.some(row => {
    const [, local, , state] = row.trim().split(/\s+/);
    if (local === undefined || state === undefined) return false;
    return state === table.acceptingState && Number.parseInt(local.slice(local.lastIndexOf(":") + 1), 16) === port;
  });
};

const linuxListenerAbsent = async (port: number): Promise<boolean> => {
  const accepting = await Promise.all(LINUX_SOCKET_TABLES.map(async table => {
    const text = await readSocketTable(table);
    return text !== null && hasAcceptingSocket(table, text, port);
  }));
  return !accepting.includes(true);
};

/**
 * Retirement proof: true only when no TCP listener and no peerless UDP socket
 * remains on the port, on any address. Outgoing connections do not count.
 */
export const checkPortListenerAbsent: PortCheckFn =
  process.platform === "linux"
    ? port => withTimeout(linuxListenerAbsent(port), SOCKET_TABLE_TIMEOUT_MS, `socket tables for port ${port}`)
    // BSD-derived stacks (macOS) test a SO_REUSEADDR TCP bind, which Bun.listen
    // sets, only against sockets without a peer, so there the bind probe
    // already ignores outgoing TCP connections.
    : checkPortFree;

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
