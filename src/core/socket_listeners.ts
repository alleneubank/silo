import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { SOCKET_TABLE_TIMEOUT_MS } from "./constants";
import { runCommand, type CommandResult } from "../utils/exec";
import { SiloError } from "../utils/errors";
import { withTimeout } from "../utils/timeout";

const OBSERVATION_BYTES_MAX = 1024 * 1024;
const IPV6_SYSCTL = "/proc/sys/net/ipv6";
const TABLES = ["tcp", "udp", "tcp6", "udp6"] as const;
type Table = (typeof TABLES)[number];

type Observation =
  | { platform: "linux"; readText: (path: string, signal: AbortSignal) => Promise<string>; exists: (path: string, signal: AbortSignal) => Promise<boolean> }
  | { platform: "darwin"; listSockets: (signal: AbortSignal) => Promise<CommandResult> }
  | { platform: "unsupported" };

const refuse = (context: string): never => {
  throw new SiloError(`Cannot prove listener absence: ${context}`, "SOCKET_OBSERVATION_FAILED");
};
const missing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";

// Validate the whole observation before using any row as evidence of absence.
const linuxAccepts = (table: Table, text: string, port: number): boolean => {
  if (text.length > OBSERVATION_BYTES_MAX || !text.endsWith("\n")) refuse(`${table}: incomplete or oversized table`);
  const [header = "", ...rows] = text.split("\n");
  const columns = header.trim().split(/\s+/);
  if (columns[0] !== "sl" || columns[1] !== "local_address" ||
      !["rem_address", "remote_address"].includes(columns[2] ?? "") || columns[3] !== "st") refuse(`${table}: unexpected header`);
  const endpoint = table.endsWith("6") ? /^[0-9A-F]{32}:[0-9A-F]{4}$/ : /^[0-9A-F]{8}:[0-9A-F]{4}$/;
  let accepts = false;
  for (const row of rows) {
    if (!row.trim()) continue;
    const fields = row.trim().split(/\s+/);
    const [slot = "", local = "", remote = "", state = "", queues = "", timer = "", retransmits = "", uid = "", timeout = "", inode = ""] = fields;
    const validState = table.startsWith("tcp") ? /^(0[1-9A-D])$/ : /^(01|07)$/;
    if (fields.length < 10 || !/^\d+:$/.test(slot) || !endpoint.test(local) || !endpoint.test(remote) ||
        !validState.test(state) || !/^[0-9A-F]{8}:[0-9A-F]{8}$/.test(queues) ||
        !/^[0-9A-F]{2}:[0-9A-F]{8}$/.test(timer) || !/^[0-9A-F]{8}$/.test(retransmits) ||
        ![uid, timeout, inode].every(value => /^\d+$/.test(value))) refuse(`${table}: malformed socket row`);
    const acceptingState = table.startsWith("tcp") ? "0A" : "07";
    if (state === acceptingState && Number.parseInt(local.slice(-4), 16) === port) accepts = true;
  }
  return accepts;
};

const linuxAbsent = async (port: number, source: Extract<Observation, { platform: "linux" }>, signal: AbortSignal): Promise<boolean> => {
  const observations = await Promise.all(TABLES.map(async table => {
    try { return { table, text: await source.readText(`/proc/net/${table}`, signal) }; }
    catch (error) {
      if (table.endsWith("6") && missing(error)) return { table, text: null };
      throw error;
    }
  }));
  const missingIPv6 = observations.filter(({ text }) => text === null);
  // Per-interface disable flags can differ from conf/all. Only absence of the
  // kernel's IPv6 sysctl subtree independently explains missing IPv6 tables.
  if (missingIPv6.length > 0 && (missingIPv6.length !== 2 || await source.exists(IPV6_SYSCTL, signal))) {
    refuse("missing IPv6 socket table without proof that IPv6 is unavailable");
  }
  const accepting = observations.map(({ table, text }) => text !== null && linuxAccepts(table, text, port));
  return !accepting.includes(true);
};

const TCP_STATES = new Set(["CLOSED", "LISTEN", "SYN_SENT", "SYN_RCVD", "ESTABLISHED", "CLOSE_WAIT", "FIN_WAIT_1", "CLOSING", "LAST_ACK", "FIN_WAIT_2", "TIME_WAIT"]);

const endpointPort = (endpoint: string): number => {
  const separator = endpoint.lastIndexOf(":");
  const address = endpoint.slice(0, separator);
  const value = endpoint.slice(separator + 1);
  const ip = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  // lsof represents unbound sockets as *:*. They accept no declared port.
  if (separator < 0 || (address !== "*" && isIP(ip) === 0) || !/^(\d{1,5}|\*)$/.test(value)) refuse("lsof: malformed endpoint");
  if (value === "*") return 0;
  const port = Number(value);
  if (port > 65535) refuse("lsof: port out of range");
  return port;
};

const lsofAccepts = (line: string, port: number): boolean => {
  const fields = line.split("\0");
  if (fields.pop() !== "" || !/^f\d+$/.test(fields.shift() ?? "")) refuse("lsof: malformed file record");
  const values = new Map<string, string>();
  for (const field of fields) {
    const tag = field[0] ?? "";
    if (!["P", "n", "T"].includes(tag) || values.has(tag)) refuse("lsof: unexpected or duplicate field");
    values.set(tag, field.slice(1));
  }
  const protocol = values.get("P");
  if (protocol !== "TCP" && protocol !== "UDP") refuse("lsof: missing socket protocol");
  const endpoints = (values.get("n") ?? "").split("->");
  if (endpoints.length > 2) refuse("lsof: malformed socket name");
  const localPort = endpointPort(endpoints[0] ?? "");
  if (endpoints[1] !== undefined) endpointPort(endpoints[1]);
  if (protocol === "UDP") {
    if (values.has("T")) refuse("lsof: unexpected UDP state");
    return localPort === port && endpoints.length === 1;
  }
  const state = values.get("T") ?? "";
  if (!state.startsWith("ST=") || !TCP_STATES.has(state.slice(3))) refuse("lsof: missing or unknown TCP state");
  return localPort === port && state === "ST=LISTEN";
};

const darwinAbsent = async (port: number, source: Extract<Observation, { platform: "darwin" }>, signal: AbortSignal): Promise<boolean> => {
  const { exitCode, stdout, stderr } = await source.listSockets(signal);
  if (exitCode !== 0 || stderr !== "" || !stdout.endsWith("\0\n") || stdout.length > OBSERVATION_BYTES_MAX) refuse("lsof: failed or incomplete listing");
  let files = 0;
  let processSeen = false;
  let accepts = false;
  for (const line of stdout.slice(0, -1).split("\n")) {
    if (line.endsWith("\0") && /^p[1-9]\d*$/.test(line.slice(0, -1))) {
      if (processSeen && files === 0) refuse("lsof: incomplete process record");
      processSeen = true;
      files = 0;
    } else {
      if (!processSeen) refuse("lsof: missing process record");
      const accepting = lsofAccepts(line, port);
      accepts ||= accepting;
      files++;
    }
  }
  if (!processSeen || files === 0) refuse("lsof: no complete socket records");
  return !accepts;
};

/** A failed observation rejects; callers retain ownership on rejection. */
export const createListenerProbe = (source: Observation, timeoutMs = SOCKET_TABLE_TIMEOUT_MS) => (port: number): Promise<boolean> => {
  const cancellation = new AbortController();
  const observe = async () => {
    switch (source.platform) {
      case "linux": return await linuxAbsent(port, source, cancellation.signal);
      case "darwin": return await darwinAbsent(port, source, cancellation.signal);
      case "unsupported": return refuse("listener observation is supported only on Linux and macOS");
    }
  };
  return withTimeout({ result: observe(), cancel: () => cancellation.abort() }, timeoutMs, `socket observation for port ${port}`);
};

const nativeObservation = (): Observation => {
  switch (process.platform) {
    case "linux": return {
      platform: "linux",
      readText: (file, signal) => readFile(file, { encoding: "utf8", signal }),
      exists: async file => {
        try { await stat(file); return true; }
        catch (error) { if (missing(error)) return false; throw error; }
      },
    };
    case "darwin": return {
      platform: "darwin",
      // NUL fields and numeric endpoints avoid column widths, names and locale.
      listSockets: signal => runCommand(["/usr/sbin/lsof", "-nP", "-iTCP", "-iUDP", "-F0pfPnT", "-Ts"], {
        signal, stdio: "pipe", timeoutMs: SOCKET_TABLE_TIMEOUT_MS, context: "native socket listing", env: { LC_ALL: "C" },
      }),
    };
    default: return { platform: "unsupported" };
  }
};

export const checkListenerAbsent = createListenerProbe(nativeObservation());
