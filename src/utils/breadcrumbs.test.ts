import { describe, expect, test } from "bun:test";
import {
  configExistsMessage,
  downKeptClusterHint,
  envDidNotStartHint,
  missingToolsMessage,
  runningStackHintLines,
  tiltApiHintLines,
  unknownDocTopicMessage,
} from "./breadcrumbs";

describe("tiltApiHintLines", () => {
  test("names the allocated port and the get command", () => {
    expect(tiltApiHintLines(10351)).toEqual([
      "Tilt API is on port 10351 (pid-alive is not resource health).",
      "  tilt get uiresources --port 10351",
      "  silo doc tilt",
    ]);
  });

  test("omits --port when TILT_PORT was not allocated", () => {
    expect(tiltApiHintLines(undefined)).toEqual([
      "Tilt API is on the default port (pid-alive is not resource health).",
      "  tilt get uiresources",
      "  silo doc tilt",
    ]);
  });

  test("treats a blank port as unset", () => {
    expect(tiltApiHintLines("  ")).toEqual(tiltApiHintLines(undefined));
  });
});

describe("runningStackHintLines", () => {
  test("when Tilt is running, prints API, kubeconfig, and URL isolation", () => {
    expect(
      runningStackHintLines({
        tiltRunning: true,
        tiltPort: 10351,
        urls: { WEB_URL: "http://dev.localhost:3000" },
        kubeconfigPath: "/tmp/kubeconfig",
      })
    ).toEqual([
      "Tilt API is on port 10351 (pid-alive is not resource health).",
      "  tilt get uiresources --port 10351",
      "  silo doc tilt",
      "kubectl: export KUBECONFIG=/tmp/kubeconfig",
      "For HTTP, use the *.localhost URLs below, not localhost:PORT (cookies are shared across localhost ports).",
    ]);
  });

  test("when Tilt is stopped, skips the API hint", () => {
    expect(
      runningStackHintLines({
        tiltRunning: false,
        tiltPort: 10351,
        urls: { WEB_URL: "http://localhost:3000" },
        kubeconfigPath: undefined,
      })
    ).toEqual([]);
  });

  test("skips URL isolation when no HTTP URL uses *.localhost", () => {
    const lines = runningStackHintLines({
      tiltRunning: true,
      tiltPort: 10350,
      urls: {
        WEB_URL: "http://127.0.0.1:3000",
        REDIS_URL: "redis://localhost:6379",
      },
      kubeconfigPath: undefined,
    });
    expect(lines.some((line) => line.includes("localhost:PORT"))).toBe(false);
  });
});

describe("envDidNotStartHint", () => {
  test("names the env file to source", () => {
    expect(envDidNotStartHint("/tmp/proj/.localnet.env")).toContain(
      "source /tmp/proj/.localnet.env"
    );
    expect(envDidNotStartHint("/tmp/proj/.localnet.env")).toContain("silo up");
    expect(envDidNotStartHint("/tmp/proj/.localnet.env")).toContain("k3d");
  });
});

describe("downKeptClusterHint", () => {
  test("points at --delete-cluster", () => {
    expect(downKeptClusterHint()).toContain("silo down --delete-cluster");
  });
});

describe("missingToolsMessage", () => {
  test("includes install URLs for known tools", () => {
    const message = missingToolsMessage(["janitor", "tilt", "docker"]);
    expect(message).toContain("Missing required tools: janitor, tilt, docker");
    expect(message).toContain("https://github.com/alleneubank/janitor");
    expect(message).toContain("https://docs.tilt.dev/install.html");
    expect(message).toContain("https://docs.docker.com/get-docker/");
  });

  test("omits a hint line for unknown tools", () => {
    expect(missingToolsMessage(["made-up-cli"])).toBe(
      "Missing required tools: made-up-cli"
    );
  });
});

describe("unknownDocTopicMessage", () => {
  test("lists available topics", () => {
    expect(unknownDocTopicMessage("nope", ["tilt", "config"])).toBe(
      "Unknown doc topic: nope. Available: tilt, config"
    );
  });
});

describe("configExistsMessage", () => {
  test("points at up and config docs", () => {
    expect(configExistsMessage("/tmp/silo.toml")).toBe(
      "Config file already exists: /tmp/silo.toml. Run 'silo up' to start, or 'silo doc config'."
    );
  });
});
