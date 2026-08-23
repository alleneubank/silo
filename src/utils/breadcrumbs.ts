export const tiltApiHintLines = (
  tiltPort: string | number | undefined
): readonly string[] => {
  const port = String(tiltPort ?? "").trim();
  if (port.length > 0) {
    return [
      `Tilt API is on port ${port} (pid-alive is not resource health).`,
      `  tilt get uiresources --port ${port}`,
      "  silo doc tilt",
    ];
  }
  return [
    "Tilt API is on the default port (pid-alive is not resource health).",
    "  tilt get uiresources",
    "  silo doc tilt",
  ];
};

export const runningStackHintLines = (params: {
  tiltRunning: boolean;
  tiltPort: string | number | undefined;
  urls: Record<string, string>;
  kubeconfigPath: string | undefined;
}): readonly string[] => {
  const lines: string[] = [];
  if (params.tiltRunning) {
    lines.push(...tiltApiHintLines(params.tiltPort));
  }
  if (params.kubeconfigPath) {
    lines.push(`kubectl: export KUBECONFIG=${params.kubeconfigPath}`);
  }
  if (
    Object.values(params.urls).some((url) =>
      /^https?:\/\/[^/]*\.localhost(?::|\/|$)/.test(url)
    )
  ) {
    lines.push(
      "For HTTP, use the *.localhost URLs below, not localhost:PORT (cookies are shared across localhost ports)."
    );
  }
  return lines;
};

export const envDidNotStartHint = (envPath: string): string =>
  `Did not start Tilt or k3d. Run 'silo up' to start, or: set -a; source ${envPath}; set +a`;

export const downKeptClusterHint = (): string =>
  "Tilt stopped; k3d cluster kept. Run 'silo down --delete-cluster' to remove it.";

const TOOL_INSTALL_HINTS: Record<string, string> = {
  janitor: "https://github.com/alleneubank/janitor",
  tilt: "https://docs.tilt.dev/install.html",
  k3d: "https://k3d.io",
  kubectl: "https://kubernetes.io/docs/tasks/tools/",
  docker: "https://docs.docker.com/get-docker/",
};

export const missingToolsMessage = (tools: readonly string[]): string => {
  const header = `Missing required tools: ${tools.join(", ")}`;
  const hints = tools
    .map((tool) => {
      const url = TOOL_INSTALL_HINTS[tool];
      return url ? `  ${tool}: ${url}` : undefined;
    })
    .filter((line): line is string => line !== undefined);
  if (hints.length === 0) {
    return header;
  }
  return `${header}\n${hints.join("\n")}`;
};

export const unknownDocTopicMessage = (
  topic: string,
  available: readonly string[]
): string =>
  `Unknown doc topic: ${topic}. Available: ${available.join(", ")}`;

export const configExistsMessage = (configPath: string): string =>
  `Config file already exists: ${configPath}. Run 'silo up' to start, or 'silo doc config'.`;
