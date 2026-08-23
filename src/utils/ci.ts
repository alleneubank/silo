import { SiloError } from "./errors";

const isTruthy = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return true;
};

const isCiEnv = (): boolean =>
  isTruthy(process.env.GITHUB_ACTIONS) || isTruthy(process.env.CI);

export const shouldExportCiEnv = (exportCi: boolean | undefined): boolean =>
  Boolean(exportCi) || isCiEnv();

/**
 * The environment `silo ci` hands Tilt.
 *
 * Tiltfiles routinely gate their e2e resources on `os.environ.get("CI")`, and
 * running those resources is what `silo ci` is for. GitHub Actions sets CI for
 * free, so a workflow never states it and the gap only shows up locally: the
 * gated resources stay manual, never run, and `tilt ci` still reports success
 * because every workload it did build is healthy.
 */
export const withCiEnv = (env: Record<string, string>): Record<string, string> => ({
  ...env,
  CI: "true",
});

/**
 * Where to append CI env vars, or null when there is nowhere to put them.
 *
 * Only GitHub Actions promises a GITHUB_ENV file; `CI=true` on its own does
 * not, and inferring the export from CI must not turn a local run fatal. An
 * explicit `--export-ci` is different: the caller asked for the export, so
 * having nowhere to write it is an error rather than a silent skip.
 */
export const resolveGithubEnvPath = (explicit: boolean): string | null => {
  const githubEnvPath = process.env.GITHUB_ENV;
  if (!githubEnvPath || githubEnvPath.trim().length === 0) {
    if (explicit) {
      throw new SiloError(
        "GITHUB_ENV is not set; cannot export env vars for CI",
        "GITHUB_ENV_MISSING"
      );
    }
    return null;
  }
  return githubEnvPath;
};
