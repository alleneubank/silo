import { readFileSync } from "node:fs";
import { SiloError } from "../utils/errors";

export type PortRange = { readonly first: number; readonly last: number };

/** Unprivileged ports silo may hand out; the kernel's ephemeral range is removed from these. */
const ALLOCATABLE: PortRange = { first: 1024, last: 65535 };
const SYSCTL_TIMEOUT_MS = 5000;

const parseRange = (text: string, source: string): PortRange => {
  const values = text.trim().split(/\s+/).map(Number);
  const [first, last] = values;
  if (values.length !== 2 || first === undefined || last === undefined || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last > 65535 || first > last) {
    throw new SiloError(`EPHEMERAL_RANGE_UNAVAILABLE: cannot parse the kernel ephemeral port range from ${source}; port allocation refused`, "EPHEMERAL_RANGE_UNAVAILABLE");
  }
  return { first, last };
};

/**
 * The live range the kernel assigns outgoing and port-0 binds from, read at
 * allocation. A port inside it passes a bind probe now and can be taken by
 * the kernel later (an SSH master's forward, an outgoing connection).
 */
export const kernelEphemeralRange = (): PortRange => {
  if (process.platform === "linux") {
    const source = "/proc/sys/net/ipv4/ip_local_port_range";
    let text: string;
    try { text = readFileSync(source, "utf8"); }
    catch (cause) { throw new SiloError(`EPHEMERAL_RANGE_UNAVAILABLE: cannot read ${source}; port allocation refused`, "EPHEMERAL_RANGE_UNAVAILABLE", { cause }); }
    return parseRange(text, source);
  }
  if (process.platform === "darwin") {
    const source = "sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last";
    const result = Bun.spawnSync(["/usr/sbin/sysctl", "-n", "net.inet.ip.portrange.first", "net.inet.ip.portrange.last"], {
      env: { PATH: "/usr/sbin:/usr/bin:/bin", LC_ALL: "C" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: SYSCTL_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) throw new SiloError(`EPHEMERAL_RANGE_UNAVAILABLE: ${source} failed; port allocation refused`, "EPHEMERAL_RANGE_UNAVAILABLE");
    return parseRange(result.stdout.toString("utf8"), source);
  }
  throw new SiloError("EPHEMERAL_RANGE_UNAVAILABLE: port allocation requires Linux or macOS", "EPHEMERAL_RANGE_UNAVAILABLE");
};

export const insideRange = (port: number, range: PortRange): boolean => port >= range.first && port <= range.last;

/**
 * Fallback candidates outside the ephemeral range, highest first: high ports
 * are the least likely to collide with services' well-known defaults.
 */
export const fallbackPorts = (ephemeral: PortRange): number[] => {
  const ports: number[] = [];
  for (let port = ALLOCATABLE.last; port >= ALLOCATABLE.first; port -= 1) {
    if (!insideRange(port, ephemeral)) ports.push(port);
  }
  if (ports.length === 0) throw new SiloError(`PORTS_EXHAUSTED: the ephemeral range ${ephemeral.first}-${ephemeral.last} leaves no allocatable port`, "PORTS_EXHAUSTED");
  return ports;
};
