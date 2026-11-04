import path from "node:path";
import { SiloError } from "../utils/errors";

/** Bun 1.4.4 userInfo().homedir follows HOME; query the native account database. */
export const accountHome = (): string => {
  const uid = process.geteuid?.();
  if (uid === undefined) throw new SiloError("Account identity requires Linux or macOS", "ACCOUNT_UNAVAILABLE");
  let command: string[];
  if (process.platform === "linux") command = ["/usr/bin/getent", "passwd", String(uid)];
  else if (process.platform === "darwin") command = ["/usr/bin/dscacheutil", "-q", "user", "-a", "uid", String(uid)];
  else throw new SiloError("Account identity requires Linux or macOS", "ACCOUNT_UNAVAILABLE");
  const result = Bun.spawnSync(command, { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 5000 });
  if (result.exitCode !== 0 || result.stdout.byteLength > 64 * 1024) throw new SiloError("Cannot query native account home; refusing a split allocation domain", "ACCOUNT_UNAVAILABLE");
  const output = result.stdout.toString("utf8");
  const homes = process.platform === "linux"
    ? output.trim().split("\n").filter(Boolean).map(line => { const fields = line.split(":"); return fields.length === 7 && fields[2] === String(uid) ? fields[5] : undefined; })
    : [...output.matchAll(/^dir: (.+)$/gm)].map(match => match[1]);
  const home = homes[0];
  if (homes.length !== 1 || !home || !path.isAbsolute(home) || home.includes("\0")) throw new SiloError("Native account home is missing or ambiguous", "ACCOUNT_UNAVAILABLE");
  return home;
};

/** HOME scrubbing cannot split an account's allocation authority. */
export const accountStorePath = (): string => path.join(accountHome(), ".silo", "leases.sqlite");
