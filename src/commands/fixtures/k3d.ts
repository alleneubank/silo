import { readFileSync, writeFileSync } from "node:fs";

const cluster = Bun.argv[4]!;
const mode = readFileSync("tools-fixture", "utf8");
const cache = JSON.parse(readFileSync("cache.json", "utf8"));
const labels: Record<string, string> = { app: "k3d", "k3d.cluster": cluster, "k3d.role": "noRole" };
if (mode === "cluster") labels["k3d.cluster"] = "peer";
if (mode === "role") labels["k3d.role"] = "agent";
if (mode === "app") labels.app = "peer";
if (mode === "owner") labels["io.silo.project"] = "peer";
if (mode === "generation") labels["io.silo.generation"] = "9";
writeFileSync("tools.json", JSON.stringify({
  Id: "a".repeat(64), Name: `/k3d-${cluster}-tools`, Created: "2026-01-01T00:00:01Z",
  Config: { Labels: labels }, HostConfig: { Binds: [`${cache.Name}:/k3d/images`] },
  Mounts: [{ Type: "volume", Name: mode === "mount" ? "peer-cache" : cache.Name, Destination: "/k3d/images" }],
  State: { Running: true }, NetworkSettings: { Ports: {} },
}));
writeFileSync("ready", "ready");
await Bun.sleep(60_000);
