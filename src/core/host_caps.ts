import path from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import { SiloError } from "../utils/errors";
import { accountHome } from "./allocation_domain";
import { HostConfigSchema, SlotNameSchema, type HostCaps, type SlotName } from "./slot_types";

const MAX_HOST_CONFIG_BYTES = 64 * 1024;

/** The host operator's file, resolved through the native account home like the store. */
export const hostConfigPath = (): string => path.join(accountHome(), ".silo", "host.toml");

/** A missing file caps nothing: every slot is unavailable until the operator names it. */
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
