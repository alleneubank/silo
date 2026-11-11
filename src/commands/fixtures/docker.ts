import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const args = Bun.argv.slice(2);
const [kind, action] = args;
const cacheFile = "cache.json";
const cache = () => JSON.parse(readFileSync(cacheFile, "utf8"));
if (kind === "context") console.log("unix:///private-fixture.sock");
else if (kind === "info") console.log(JSON.stringify({ ID: "fixture-engine", OSType: "linux" }));
else if (action === "create") {
  const name = args.at(-1)!;
  if (kind === "volume") {
    const labels: Record<string, string> = {};
    args.forEach((arg, index) => {
      if (arg === "--label") {
        const label = args[index + 1]!;
        const separator = label.indexOf("=");
        labels[label.slice(0, separator)] = label.slice(separator + 1);
      }
    });
    writeFileSync(cacheFile, JSON.stringify({ Name: name, CreatedAt: "2026-01-01T00:00:00Z", Labels: labels }));
  }
  console.log(name);
} else if (action === "ls") {
  if (kind === "network" && !args.includes("--filter")) console.log(JSON.stringify({ ID: "bridge-id", Name: "bridge" }));
  if (kind === "volume" && existsSync(cacheFile)) console.log(JSON.stringify({ Name: cache().Name }));
} else if (action === "inspect") {
  if (kind === "network") console.log(JSON.stringify([{ Id: "bridge-id", Name: "bridge" }]));
  else if (kind === "volume") console.log(JSON.stringify([cache()]));
  else process.exit(1);
} else if (kind === "volume" && action === "rm") {
  unlinkSync(cacheFile);
  console.log(args[2]);
} else throw new Error(`Unexpected fixture request: ${args.join(" ")}`);
