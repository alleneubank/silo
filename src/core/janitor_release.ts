/**
 * The one Janitor release silo ships. scripts/fetch-janitor.ts downloads and
 * checks these archives into vendor/janitor/<platform>/janitor; silo checks the
 * binary digest again before it first executes its copy.
 */
export const JANITOR_VERSION = "0.3.1";

export const JANITOR_PLATFORMS = ["macos-arm64", "macos-x86_64", "linux-aarch64", "linux-x86_64"] as const;
export type JanitorPlatform = typeof JANITOR_PLATFORMS[number];

type JanitorArtifact = {
  /** Release asset name; `.zip` on macOS, `.tar.gz` on Linux. */
  archive: string;
  archiveSha256: string;
  /** SHA-256 of the `janitor` binary inside the archive. */
  binarySha256: string;
};

export const JANITOR_ARTIFACTS: Readonly<Record<JanitorPlatform, JanitorArtifact>> = {
  "macos-arm64": {
    archive: "janitor-0.3.1-macos-arm64.zip",
    archiveSha256: "331a9cb5040a5e059fe52f630788ba79099a117bf7f8c6973ff1af8ac12a03b6",
    binarySha256: "56f526d77ddd382b6eb1f638e1967df9fedaf9b23e3bd5237a692016dd474ef6",
  },
  "macos-x86_64": {
    archive: "janitor-0.3.1-macos-x86_64.zip",
    archiveSha256: "30b6f7cad1c9085e8e5b1c2b4062a6d11a338d1ee9a49ac83bb68db1f331723b",
    binarySha256: "05fc1710a06f110ba3c090bd31f3ba0fd43745cdd58fc8845280b9aecc98003f",
  },
  "linux-aarch64": {
    archive: "janitor-0.3.1-linux-aarch64.tar.gz",
    archiveSha256: "e60f29d9297fd201de7dc095b72d960b05bf5d0e5669769dd32dc0c3cc8dd368",
    binarySha256: "4c7ab61f1be4eefe8acab75c681815d58420224b395a286491feb5d3c4cdc2a3",
  },
  "linux-x86_64": {
    archive: "janitor-0.3.1-linux-x86_64.tar.gz",
    archiveSha256: "55fd9362fb3056a679cd8269377ae7560938a6b6c14d2a208b99384b536ea9bf",
    binarySha256: "51eff163415e5d8944c0f2e6762a4bbfec9adb2e1d25a3c47c03011fc98c2b5a",
  },
};

export const janitorReleaseUrl = (platform: JanitorPlatform): string =>
  `https://github.com/alleneubank/janitor/releases/download/v${JANITOR_VERSION}/${JANITOR_ARTIFACTS[platform].archive}`;

/** The archive's top-level directory, which holds `janitor` and `LICENSE`. */
export const janitorArchiveRoot = (platform: JanitorPlatform): string => `janitor-${JANITOR_VERSION}-${platform}`;
