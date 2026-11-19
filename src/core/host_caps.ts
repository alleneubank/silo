import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { SiloError } from "../utils/errors";
import { accountHome } from "./allocation_domain";
import { HostConfigSchema, SlotNameSchema, type HostCaps, type SlotName, type SlotRun } from "./slot_types";

const MAX_HOST_CONFIG_BYTES = 64 * 1024;

/** The host operator's file, resolved through the native account home like the store. */
export const hostConfigPath = (): string => path.join(accountHome(), ".silo", "host.toml");

/** A missing file overrides nothing: project defaults decide every slot. */
export const readHostCaps = (file = hostConfigPath()): HostCaps => {
  if (!existsSync(file)) return new Map();
  if (statSync(file).size > MAX_HOST_CONFIG_BYTES) throw new SiloError(`INVALID_HOST_CONFIG: ${file} exceeds 64 KiB`, "INVALID_HOST_CONFIG");
  let parsed: unknown;
  try { parsed = Bun.TOML.parse(readFileSync(file, "utf8")); }
  catch (cause) { throw new SiloError(`INVALID_HOST_CONFIG: ${file} is not valid TOML`, "INVALID_HOST_CONFIG", { cause }); }
  const result = HostConfigSchema.safeParse(parsed);
  if (!result.success) throw new SiloError(`INVALID_HOST_CONFIG: ${file}: ${result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`, "INVALID_HOST_CONFIG");
  const caps = new Map<SlotName, number>();
  for (const [name, cap] of Object.entries(result.data.slots)) {
    const slot = SlotNameSchema.safeParse(name);
    if (!slot.success) throw new SiloError(`INVALID_HOST_CONFIG: ${file}: slot '${name}' uses characters other than lowercase letters, digits and '-'`, "INVALID_HOST_CONFIG");
    caps.set(slot.data, cap);
  }
  return caps;
};

/** A project default recorded by a queued run, or declared by the project at hand. */
export type ProjectDefault = { root: string; cap: number };

/**
 * Where a slot's effective cap comes from: the host file's entry, else the
 * smallest default of every project contending for the slot. `off` is a host
 * entry of 0; `none` means no source caps the slot here.
 */
export type SlotCap =
  | { kind: "host"; cap: number }
  | { kind: "project"; cap: number; defaults: readonly ProjectDefault[] }
  | { kind: "off" }
  | { kind: "none" };

/** One entry per root and cap, smallest cap first. */
export const distinctDefaults = (defaults: readonly ProjectDefault[]): ProjectDefault[] =>
  [...new Map(defaults.map(item => [`${item.cap}\0${item.root}`, item])).values()]
    .sort((a, b) => a.cap - b.cap || a.root.localeCompare(b.root));

export const resolveSlotCap = (host: HostCaps, slot: SlotName, defaults: readonly ProjectDefault[]): SlotCap => {
  const entry = host.get(slot);
  if (entry === 0) return { kind: "off" };
  if (entry !== undefined) return { kind: "host", cap: entry };
  const distinct = distinctDefaults(defaults);
  const smallest = distinct[0];
  return smallest === undefined ? { kind: "none" } : { kind: "project", cap: smallest.cap, defaults: distinct };
};

/** The defaults recorded by every queued run, held or waiting, that names the slot. */
export const queuedDefaults = (runs: readonly { run: SlotRun }[], slot: SlotName): ProjectDefault[] =>
  runs.flatMap(({ run }) => run.requests.flatMap(request =>
    request.slot === slot && request.cap !== undefined ? [{ root: run.root, cap: request.cap }] : []));
