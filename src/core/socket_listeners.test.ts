import { describe, expect, test } from "bun:test";
import { createListenerProbe } from "./socket_listeners";

const HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n";
const ROW = "   0: 0100007F:C350 00000000:0000 0A 00000000:00000000 00:00000000 00000000 501 0 1234\n";
const absent = () => Object.assign(new Error("missing observation"), { code: "ENOENT" });
const linux = (overrides: Record<string, string | Error> = {}, ipv6Available = true) => createListenerProbe({
  platform: "linux",
  readText: async file => {
    const value = overrides[file] ?? HEADER;
    if (value instanceof Error) throw value;
    return value;
  },
  exists: async () => ipv6Available,
});

describe("Linux listener observation", () => {
  test("a hung table read refuses at the observation deadline", async () => {
    const probe = createListenerProbe({
      platform: "linux", readText: () => new Promise(() => {}), exists: async () => true,
    }, 25);
    await expect(probe(50000)).rejects.toThrow("Timed out after 25ms");
  }, 60_000);

  for (const listening of [false, true]) test(`a slow complete observation preserves ${listening ? "presence" : "absence"}`, async () => {
    const probe = createListenerProbe({
      platform: "linux",
      readText: async file => {
        await Bun.sleep(2200);
        return HEADER + (listening && file === "/proc/net/tcp" ? ROW : "");
      },
      exists: async () => true,
    });
    expect(await probe(50000)).toBe(!listening);
  }, 60_000);

  test("complete empty tables prove absence", async () => {
    expect(await linux()(50000)).toBe(true);
  });

  for (const table of ["tcp", "udp", "tcp6", "udp6"]) {
    test(`${table} listeners refuse on every local address`, async () => {
      const row = ROW.replace("0100007F:C350", table.endsWith("6") ? "00000000000000000000000001000000:C350" : "1C00A8C0:C350")
        .replace("00000000:0000", table.endsWith("6") ? "00000000000000000000000000000000:0000" : "00000000:0000")
        .replace(" 0A ", table.startsWith("udp") ? " 07 " : " 0A ");
      expect(await linux({ [`/proc/net/${table}`]: HEADER + row })(50000)).toBe(false);
    });
  }

  test("connected TCP, connected UDP and TIME-WAIT do not refuse", async () => {
    for (const [table, state] of [["tcp", "01"], ["tcp", "06"], ["udp", "01"]]) {
      expect(await linux({ [`/proc/net/${table}`]: HEADER + ROW.replace(" 0A ", ` ${state} `) })(50000)).toBe(true);
    }
  });

  for (const missingTables of [["tcp6"], ["udp6"], ["tcp6", "udp6"]]) {
    test(`missing ${missingTables.join(" and ")} refuses while IPv6 is available`, async () => {
      const overrides = Object.fromEntries(missingTables.map(table => [`/proc/net/${table}`, absent()]));
      await expect(linux(overrides)(50000)).rejects.toThrow("missing IPv6");
    });
  }

  test("both missing IPv6 tables are explained only by independently unavailable IPv6", async () => {
    expect(await linux({ "/proc/net/tcp6": absent(), "/proc/net/udp6": absent() }, false)(50000)).toBe(true);
    await expect(linux({ "/proc/net/tcp6": absent() }, false)(50000)).rejects.toThrow("missing IPv6");
  });

  for (const table of ["tcp", "udp"]) test(`missing IPv4 ${table} always refuses`, async () => {
    await expect(linux({ [`/proc/net/${table}`]: absent() }, false)(50000)).rejects.toThrow("missing observation");
  });

  test("read errors and failed IPv6 availability observations propagate", async () => {
    await expect(linux({ "/proc/net/tcp": new Error("permission denied") })(50000)).rejects.toThrow("permission denied");
    const probe = createListenerProbe({
      platform: "linux", readText: async file => { if (file.endsWith("6")) throw absent(); return HEADER; },
      exists: async () => { throw new Error("sysctl observation failed"); },
    });
    await expect(probe(50000)).rejects.toThrow("sysctl observation failed");
  });

  for (const row of [
    "0: 0100007F:C350 00000000:0000\n",
    ROW.replace("C350", "ZZZZ"), ROW.replace("0100007F", "01007F"),
    ROW.replace("00000000:0000", "bad:0000"), ROW.replace(" 0A ", " ZZ "),
    ROW.replace(" 0A ", " 00 "), ROW.replace(" 1234", " broken"),
    ROW.trimEnd(),
  ]) test(`malformed row refuses: ${JSON.stringify(row.trim())}`, async () => {
    await expect(linux({ "/proc/net/tcp": HEADER + row })(50000)).rejects.toThrow("Cannot prove listener absence");
  });

  test("an unexpected header and an incomplete IPv6 row refuse", async () => {
    await expect(linux({ "/proc/net/tcp": "unexpected\n" })(50000)).rejects.toThrow("unexpected header");
    await expect(linux({ "/proc/net/tcp6": HEADER + ROW })(50000)).rejects.toThrow("malformed socket row");
  });
});

const FILE = "f4\0PTCP\0n127.0.0.1:50000\0TST=LISTEN\0\n";
const lsof = (stdout: string, exitCode = 0, stderr = "") => createListenerProbe({
  platform: "darwin", listSockets: async () => ({ stdout, exitCode, stderr }),
});

describe("macOS listener observation", () => {
  for (const listening of [false, true]) test(`a slow complete observation preserves ${listening ? "presence" : "absence"}`, async () => {
    const probe = createListenerProbe({
      platform: "darwin",
      listSockets: async () => {
        await Bun.sleep(2200);
        return { stdout: "p123\0\n" + FILE.replace("50000", listening ? "50000" : "50001"), exitCode: 0, stderr: "" };
      },
    });
    expect(await probe(50000)).toBe(!listening);
  }, 60_000);

  for (const endpoint of ["127.0.0.1:50000", "192.0.2.1:50000", "[::1]:50000", "*:50000"]) {
    test(`a TCP listener on ${endpoint} refuses`, async () => {
      expect(await lsof("p123\0\n" + FILE.replace("127.0.0.1:50000", endpoint))(50000)).toBe(false);
    });
  }

  test("peerless UDP refuses, connected UDP and TCP do not", async () => {
    expect(await lsof("p123\0\nf4\0PUDP\0n[::1]:50000\0\n")(50000)).toBe(false);
    expect(await lsof("p123\0\nf4\0PUDP\0n[::1]:50000->[::1]:9000\0\n")(50000)).toBe(true);
    expect(await lsof("p123\0\n" + FILE.replace("LISTEN", "ESTABLISHED").replace(":50000\0", ":50000->127.0.0.1:9000\0"))(50000)).toBe(true);
    expect(await lsof("p123\0\nf4\0PUDP\0n*:*\0\n")(50000)).toBe(true);
    expect(await lsof("p123\0\n" + FILE.replace("50000", "50001"))(50000)).toBe(true);
  });

  for (const output of ["", "p123\0\n", FILE, "p123\0\n" + FILE.slice(0, -2),
    "p123\0\n" + FILE.replace("PTCP\0", ""), "p123\0\n" + FILE.replace("TST=LISTEN\0", ""),
    "p123\0\n" + FILE.replace("LISTEN", "UNKNOWN"), "p123\0\n" + FILE.replace("50000", "99999"),
    "p123\0\n" + FILE.replace("127.0.0.1", "not-an-address"),
    "p123\0\n" + FILE.replace("PTCP\0", "PTCP\0PTCP\0"),
    "p123\0\n" + FILE + "p456\0\n",
  ]) test(`incomplete or malformed listing refuses: ${JSON.stringify(output)}`, async () => {
    await expect(lsof(output)(50000)).rejects.toThrow("Cannot prove listener absence");
  });

  test("nonzero exit, warnings and execution failure refuse", async () => {
    await expect(lsof("p123\0\n" + FILE, 1)(50000)).rejects.toThrow("failed or incomplete");
    await expect(lsof("p123\0\n" + FILE, 0, "incomplete access")(50000)).rejects.toThrow("failed or incomplete");
    await expect(createListenerProbe({ platform: "darwin", listSockets: async () => { throw new Error("exec failed"); } })(50000)).rejects.toThrow("exec failed");
  });

  test("a hung listing refuses at the observation deadline", async () => {
    const probe = createListenerProbe({ platform: "darwin", listSockets: () => new Promise(() => {}) }, 25);
    await expect(probe(50000)).rejects.toThrow("Timed out after 25ms");
  }, 60_000);

  test("other platforms refuse rather than substitute a bind", async () => {
    await expect(createListenerProbe({ platform: "unsupported" })(50000)).rejects.toThrow("supported only on Linux and macOS");
  });
});
