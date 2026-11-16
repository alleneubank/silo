import { describe, expect, test } from "bun:test";
import net from "node:net";
import { once } from "node:events";
import { networkInterfaces } from "node:os";
import { connectedUdp } from "./fixtures/connected_udp";
import { allocatePorts, checkPortFree, checkPortListenerAbsent, livePortSpace, type PortAllocationEvent, type PortSpace } from "./ports";
import { fallbackPorts, insideRange, kernelEphemeralRange } from "./port_range";

// A fixture space whose fallback candidates are one contiguous ascending run,
// so scan order and wrap-around are easy to state.
const FALLBACK_START = 20000;
const FALLBACK_END = 20999;
const space: PortSpace = {
  ephemeral: { first: 49152, last: 65535 },
  fallback: Array.from({ length: FALLBACK_END - FALLBACK_START + 1 }, (_, index) => FALLBACK_START + index),
};

// OS-assigned test ports usually fall inside the real ephemeral range; this
// space admits them so the native probe, not the range, decides.
const probeSpace: PortSpace = { ephemeral: { first: 1, last: 1 }, fallback: space.fallback };

const alwaysFree = async (_port: number): Promise<boolean> => true;

describe("allocatePorts", () => {
  test("allocates random ports from the fallback space in order", async () => {
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random", API_PORT: "random" },
      order: ["APP_PORT", "API_PORT"],
      lockfilePorts: undefined,
      force: false,
      space,
      isPortFree: alwaysFree,
    });

    expect(allocated.APP_PORT).toBe(FALLBACK_START);
    expect(allocated.API_PORT).toBe(FALLBACK_START + 1);
  });

  test("reuses lockfile ports even when config uses random", async () => {
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: { APP_PORT: 30000 },
      force: false,
      space,
      isPortFree: alwaysFree,
      onEvent: (event) => events.push(event),
    });

    expect(allocated.APP_PORT).toBe(30000);
    expect(events[0]?.source).toBe("lockfile");
    expect(events[0]?.requestedDefault).toBe("random");
  });

  test("falls back to the fallback space when default port is occupied", async () => {
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
      space,
      isPortFree: mockCheck,
      onEvent: (event) => events.push(event),
    });

    expect(allocated.WEB_PORT).toBe(FALLBACK_START);
    expect(events[0]?.source).toBe("fallback");
  });

  test("falls back to the fallback space when lockfile port is occupied", async () => {
    const occupiedPorts = new Set([30000]);
    const mockCheck = async (port: number): Promise<boolean> =>
      !occupiedPorts.has(port);

    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: { APP_PORT: 30000 },
      force: false,
      space,
      isPortFree: mockCheck,
      onEvent: (event) => events.push(event),
    });

    expect(allocated.APP_PORT).toBe(FALLBACK_START);
    expect(events[0]?.source).toBe("fallback");
  });

  test("skips occupied ports when scanning the fallback space", async () => {
    // First two fallback ports are taken
    const occupiedPorts = new Set([
      FALLBACK_START,
      FALLBACK_START + 1,
    ]);
    const mockCheck = async (port: number): Promise<boolean> =>
      !occupiedPorts.has(port);

    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: undefined,
      force: false,
      space,
      isPortFree: mockCheck,
    });

    expect(allocated.APP_PORT).toBe(FALLBACK_START + 2);
  });

  test("excludedPorts are skipped during the fallback scan", async () => {
    const excluded = new Set<number>([
      FALLBACK_START,
      FALLBACK_START + 1,
      FALLBACK_START + 2,
    ]);
    const allocated = await allocatePorts({
      ports: { A: "random", B: "random" },
      order: ["A", "B"],
      lockfilePorts: undefined,
      force: false,
      space,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
    });
    expect(allocated.A).toBe(FALLBACK_START + 3);
    expect(allocated.B).toBe(FALLBACK_START + 4);
  });

  test("excludedPorts force the configured default to the fallback space", async () => {
    const excluded = new Set<number>([3000]);
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { WEB_PORT: 3000 },
      order: ["WEB_PORT"],
      lockfilePorts: undefined,
      force: false,
      space,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
      onEvent: (event) => events.push(event),
    });
    expect(allocated.WEB_PORT).toBe(FALLBACK_START);
    expect(events[0]?.source).toBe("fallback");
  });

  test("excludedPorts force lockfile ports to the fallback space", async () => {
    const excluded = new Set<number>([30000]);
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { APP_PORT: "random" },
      order: ["APP_PORT"],
      lockfilePorts: { APP_PORT: 30000 },
      force: false,
      space,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
      onEvent: (event) => events.push(event),
    });
    expect(allocated.APP_PORT).toBe(FALLBACK_START);
    expect(events[0]?.source).toBe("fallback");
  });

  test("fallback scan wraps past the last candidate", async () => {
    const excluded = new Set<number>();
    for (let p = FALLBACK_START; p < FALLBACK_END; p += 1) {
      excluded.add(p);
    }
    // Only FALLBACK_END is free.
    const allocated = await allocatePorts({
      ports: { A: "random" },
      order: ["A"],
      lockfilePorts: undefined,
      force: false,
      space,
      excludedPorts: excluded,
      isPortFree: alwaysFree,
    });
    expect(allocated.A).toBe(FALLBACK_END);
  });
});

describe("ports outside the kernel ephemeral range", () => {
  test("a declared default inside the ephemeral range is never assigned", async () => {
    const events: PortAllocationEvent[] = [];
    const allocated = await allocatePorts({
      ports: { WEB_PORT: 50000 }, order: ["WEB_PORT"], lockfilePorts: undefined, force: false,
      space, isPortFree: alwaysFree, onEvent: event => events.push(event),
    });
    expect(allocated.WEB_PORT).toBe(FALLBACK_START);
    expect(events[0]?.source).toBe("fallback");
  });

  test("fallback candidates exclude the whole ephemeral range and privileged ports", () => {
    const candidates = fallbackPorts({ first: 32768, last: 60999 });
    expect(candidates[0]).toBe(65535);
    expect(candidates.some(port => port >= 32768 && port <= 60999)).toBe(false);
    expect(Math.min(...candidates)).toBe(1024);
    expect(candidates.length).toBe(65535 - 1024 + 1 - (60999 - 32768 + 1));
  });

  test("live allocation reads this host's range and stays outside it", async () => {
    const ephemeral = kernelEphemeralRange();
    expect(ephemeral.first).toBeLessThanOrEqual(ephemeral.last);
    const allocated = await allocatePorts({
      ports: { A: "random", B: "random", C: ephemeral.first }, order: ["A", "B", "C"], lockfilePorts: undefined, force: false,
      space: livePortSpace(),
    });
    for (const port of Object.values(allocated)) expect(insideRange(port, ephemeral)).toBe(false);
  });
});

describe("checkPortFree (integration)", () => {
  test("a UDP listener excludes the scalar host port", async () => {
    const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
    try { expect(await checkPortFree(socket.port)).toBe(false); }
    finally { socket.close(); }
  });

  test("an IPv6 loopback listener excludes the scalar host port", async () => {
    const server = Bun.listen({ hostname: "::1", port: 0, socket: { data() {} } });
    try { expect(await checkPortFree(server.port)).toBe(false); }
    finally { server.stop(); }
  });
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
        space: probeSpace,
        // No isPortFree: the real checkPortFree runs.
        onEvent: (event) => events.push(event),
      });

      // The allocator should detect the port is occupied and fall back
      expect(allocated.TEST_PORT).not.toBe(boundPort);
      expect(events[0]?.source).toBe("fallback");
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
        space: probeSpace,
        onEvent: (event) => events.push(event),
      });

      expect(allocated.TEST_PORT).not.toBe(boundPort);
      expect(events[0]?.source).toBe("fallback");
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
      space: probeSpace,
      onEvent: (event) => events.push(event),
    });

    // Port is genuinely free, so it should be used directly
    expect(allocated.TEST_PORT).toBe(freePort);
    expect(events[0]?.source).toBe("default");
  });
});

describe("checkPortListenerAbsent (integration)", () => {
  test("a TCP listener on any address remains", async () => {
    const nonLoopback = Object.values(networkInterfaces()).flat().find(address => address?.family === "IPv4" && !address.internal)?.address;
    for (const hostname of ["127.0.0.1", "::1", "0.0.0.0", ...(nonLoopback ? [nonLoopback] : [])]) {
      const server = Bun.listen({ hostname, port: 0, socket: { data() {} } });
      try { expect(await checkPortListenerAbsent(server.port)).toBe(false); }
      finally { server.stop(); }
    }
  }, 180_000);

  test("a UDP socket without a peer remains", async () => {
    for (const hostname of ["127.0.0.1", "::1"]) {
      const socket = await Bun.udpSocket({ hostname, port: 0 });
      try { expect(await checkPortListenerAbsent(socket.port)).toBe(false); }
      finally { socket.close(); }
    }
  }, 180_000);

  test("an outgoing TCP connection's local port is not a listener", async () => {
    const server = net.createServer(() => {});
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      await once(client, "connect");
      expect(await checkPortListenerAbsent(client.localPort!)).toBe(true);
    } finally { client.destroy(); server.close(); }
  }, 180_000);

  test("a connected UDP socket's local port is not a listener", async () => {
    for (const hostname of ["127.0.0.1", "::1"] as const) {
      const sockets = await connectedUdp(hostname);
      try {
        expect(await checkPortListenerAbsent(sockets.client.port)).toBe(false);
        await sockets.releaseListeners();
        expect(await checkPortListenerAbsent(sockets.client.port)).toBe(true);
      } finally { await sockets.close(); }
    }
  }, 180_000);

  test("an orderly closed outgoing TCP port does not block on TIME-WAIT", async () => {
    const server = net.createServer(socket => socket.resume());
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const client = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    try {
      await once(client, "connect");
      const port = client.localPort!;
      const closed = once(client, "close");
      client.end();
      await closed;
      expect(await checkPortListenerAbsent(port)).toBe(true);
    } finally { client.destroy(); server.close(); }
  }, 180_000);
});
