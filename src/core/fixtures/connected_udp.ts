import net from "node:net";
import dgram from "node:dgram";

const listen = async (hostname: string, port: number): Promise<net.Server> => {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: hostname, port, ipv6Only: hostname.includes(":") }, resolve);
  });
  return server;
};

const close = (server: net.Server): Promise<void> => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
});

/** Select one number across both protocols/families, rather than UDP alone. */
export const connectedUdp = async (hostname: "127.0.0.1" | "::1") => {
  const peer = await Bun.udpSocket({ hostname, port: 0 });
  for (let attempt = 0; attempt < 32; attempt++) {
    const reservations: net.Server[] = [];
    let other: dgram.Socket | undefined;
    let client: Awaited<ReturnType<typeof Bun.udpSocket>> | undefined;
    const releaseListeners = async () => {
      if (other) await new Promise<void>(resolve => other!.close(() => resolve()));
      other = undefined;
      await Promise.all(reservations.splice(0).map(close));
    };
    try {
      const ipv4 = await listen("0.0.0.0", 0);
      reservations.push(ipv4);
      const port = (ipv4.address() as net.AddressInfo).port;
      reservations.push(await listen("::", port));
      const ipv6 = hostname === "::1";
      other = dgram.createSocket({ type: ipv6 ? "udp4" : "udp6", ipv6Only: !ipv6 });
      await new Promise<void>((resolve, reject) => {
        other!.once("error", reject);
        other!.bind(port, ipv6 ? "0.0.0.0" : "::", resolve);
      });
      client = await Bun.udpSocket({ hostname, port, connect: { hostname, port: peer.port } });
      return {
        peer, client, releaseListeners,
        close: async () => { client!.close(); peer.close(); await releaseListeners(); },
      };
    } catch (error) {
      client?.close();
      await releaseListeners();
      if (!(error instanceof Error && "code" in error && error.code === "EADDRINUSE")) {
        peer.close();
        throw error;
      }
    }
  }
  peer.close();
  throw new Error("No cross-protocol UDP fixture port after 32 attempts");
};
