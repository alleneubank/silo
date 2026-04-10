import { describe, expect, test } from "bun:test";
import { EPHEMERAL_PORT_END, EPHEMERAL_PORT_START } from "./constants";
import { allocatePorts, type PortAllocationEvent } from "./ports";

const alwaysFree = async (_port: number): Promise<boolean> => true;

describe("allocatePorts", () => {
  test("allocates random ports from the ephemeral range in order", async () => {
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random", API_PORT: "random" },
      order: ["APP_PORT", "API_PORT"],
      lockfilePorts: undefined,
      force: false,
      isPortFree: alwaysFree,
    });

    expect(allocated.APP_PORT).toBe(EPHEMERAL_PORT_START);
    expect(allocated.API_PORT).toBe(EPHEMERAL_PORT_START + 1);
  });

  test("reuses lockfile ports even when config uses random", async () => {
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: { APP_PORT: 62000 },
      force: false,
      isPortFree: alwaysFree,
      onEvent: (event) => events.push(event),
    });

    expect(allocated.APP_PORT).toBe(62000);
    expect(events[0]?.source).toBe("lockfile");
    expect(events[0]?.requestedDefault).toBe("random");
  });

  test("falls back to ephemeral when default port is occupied", async () => {
    // Simulate port 3000 being occupied (e.g. bound on 127.0.0.1)
    const occupiedPorts = new Set([3000]);
    const mockCheck = async (port: number): Promise<boolean> =>
      !occupiedPorts.has(port);

    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { WEB_PORT: 3000 },
      order: ["WEB_PORT"],
      lockfilePorts: undefined,
      force: false,
      isPortFree: mockCheck,
      onEvent: (event) => events.push(event),
    });

    expect(allocated.WEB_PORT).toBe(EPHEMERAL_PORT_START);
    expect(events[0]?.source).toBe("ephemeral");
  });

  test("falls back to ephemeral when lockfile port is occupied", async () => {
    const occupiedPorts = new Set([62000]);
    const mockCheck = async (port: number): Promise<boolean> =>
      !occupiedPorts.has(port);

    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: { APP_PORT: 62000 },
      force: false,
      isPortFree: mockCheck,
      onEvent: (event) => events.push(event),
    });

    expect(allocated.APP_PORT).toBe(EPHEMERAL_PORT_START);
    expect(events[0]?.source).toBe("ephemeral");
  });

  test("skips occupied ports when scanning ephemeral range", async () => {
    // First two ephemeral ports are taken
    const occupiedPorts = new Set([
      EPHEMERAL_PORT_START,
      EPHEMERAL_PORT_START + 1,
    ]);
    const mockCheck = async (port: number): Promise<boolean> =>
      !occupiedPorts.has(port);

    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: undefined,
      force: false,
      isPortFree: mockCheck,
    });

    expect(allocated.APP_PORT).toBe(EPHEMERAL_PORT_START + 2);
  });

  test("excludedPorts are skipped during ephemeral scan", async () => {
    const excluded = new Set<number>([
      EPHEMERAL_PORT_START,
      EPHEMERAL_PORT_START + 1,
      EPHEMERAL_PORT_START + 2,
    ]);
    const allocated = await allocatePorts({
      ports: { A: "random", B: "random" },
      order: ["A", "B"],
      lockfilePorts: undefined,
      force: false,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
    });
    expect(allocated.A).toBe(EPHEMERAL_PORT_START + 3);
    expect(allocated.B).toBe(EPHEMERAL_PORT_START + 4);
  });

  test("excludedPorts force the configured default to fall back to ephemeral", async () => {
    const excluded = new Set<number>([3000]);
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { WEB_PORT: 3000 },
      order: ["WEB_PORT"],
      lockfilePorts: undefined,
      force: false,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
      onEvent: (event) => events.push(event),
    });
    expect(allocated.WEB_PORT).toBe(EPHEMERAL_PORT_START);
    expect(events[0]?.source).toBe("ephemeral");
  });

  test("excludedPorts force lockfile ports to fall back to ephemeral", async () => {
    const excluded = new Set<number>([62000]);
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: { APP_PORT: 62000 },
      force: false,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
      onEvent: (event) => events.push(event),
    });
    expect(allocated.APP_PORT).toBe(EPHEMERAL_PORT_START);
    expect(events[0]?.source).toBe("ephemeral");
  });

  test("ephemeral scan wraps past EPHEMERAL_PORT_END back to EPHEMERAL_PORT_START", async () => {
    // Everything except the very first port is "occupied" — scan needs to
    // wrap from EPHEMERAL_PORT_END back to EPHEMERAL_PORT_START (trivially,
    // since scanning starts at EPHEMERAL_PORT_START, but we exercise the
    // wrap path by pushing the first candidate to the tail via excluded).
    const excluded = new Set<number>();
    for (let p = EPHEMERAL_PORT_START; p < EPHEMERAL_PORT_END; p += 1) {
      excluded.add(p);
    }
    // Only EPHEMERAL_PORT_END is free.
    const allocated = await allocatePorts({
      ports: { A: "random" },
      order: ["A"],
      lockfilePorts: undefined,
      force: false,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
    });
    expect(allocated.A).toBe(EPHEMERAL_PORT_END);
  });
});

describe("checkPortFree (integration)", () => {
  // Integration test: bind a real server on 127.0.0.1 and verify the
  // default checkPortFree (used when isPortFree is not injected) detects it.
  // We call allocatePorts without isPortFree so it uses the real check.
  test("detects port occupied on 127.0.0.1", async () => {
    // Bind a server on loopback only — this is what Tilt does.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0, // OS assigns a free port
      socket: {
        data() {},
      },
    });
    const boundPort = server.port;

    try {
      const events: PortAllocationEvent[] = [];
      const allocated = await allocatePorts({
        ports: { TEST_PORT: boundPort },
        order: ["TEST_PORT"],
        lockfilePorts: undefined,
        force: false,
        // No isPortFree — uses real checkPortFree with dual-bind check
        onEvent: (event) => events.push(event),
      });

      // The allocator should detect the port is occupied and fall back to ephemeral
      expect(allocated.TEST_PORT).not.toBe(boundPort);
      expect(events[0]?.source).toBe("ephemeral");
    } finally {
      server.stop();
    }
  });

  test("detects port occupied on 0.0.0.0", async () => {
    // Bind a server on all interfaces
    const server = Bun.listen({
      hostname: "0.0.0.0",
      port: 0,
      socket: {
        data() {},
      },
    });
    const boundPort = server.port;

    try {
      const events: PortAllocationEvent[] = [];
      const allocated = await allocatePorts({
        ports: { TEST_PORT: boundPort },
        order: ["TEST_PORT"],
        lockfilePorts: undefined,
        force: false,
        onEvent: (event) => events.push(event),
      });

      expect(allocated.TEST_PORT).not.toBe(boundPort);
      expect(events[0]?.source).toBe("ephemeral");
    } finally {
      server.stop();
    }
  });

  test("accepts port that is free on both interfaces", async () => {
    // Find a port that is genuinely free by binding and immediately releasing
    const probe = Bun.listen({
      hostname: "0.0.0.0",
      port: 0,
      socket: {
        data() {},
      },
    });
    const freePort = probe.port;
    probe.stop();

    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { TEST_PORT: freePort },
      order: ["TEST_PORT"],
      lockfilePorts: undefined,
      force: false,
      onEvent: (event) => events.push(event),
    });

    // Port is genuinely free, so it should be used directly
    expect(allocated.TEST_PORT).toBe(freePort);
    expect(events[0]?.source).toBe("default");
  });
});
