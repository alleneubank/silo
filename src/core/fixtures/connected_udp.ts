import net from "node:net";
import dgram from "node:dgram";

const listen = async (hostname: string, port: number): Promise<net.Server> => {
  const server = net.createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: hostname, port, ipv6Only: hostname.includes(":") }, resolve);
  });
  return server;
};

const close = (server: net.Server): Promise<void> => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
});

const bindUdp = async (ipv6: boolean, port: number): Promise<dgram.Socket> => {
  const socket = dgram.createSocket({ type: ipv6 ? "udp6" : "udp4", ipv6Only: ipv6 });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(port, ipv6 ? "::" : "0.0.0.0", resolve);
    });
    return socket;
  } catch (error) {
    await closeUdp(socket);
    throw error;
  }
};

const closeUdp = (socket: dgram.Socket): Promise<void> => new Promise(resolve => socket.close(resolve));

/** Select one number across both protocols/families, rather than UDP alone. */
export const connectedUdp = async (hostname: "127.0.0.1" | "::1") => {
  const peer = await Bun.udpSocket({ hostname, port: 0 });
  for (let attempt = 0; attempt < 32; attempt++) {
    const reservations: net.Server[] = [];
    let other: dgram.Socket | undefined;
    let client: dgram.Socket | undefined;
    const releaseListeners = async () => {
      if (other) await closeUdp(other);
      other = undefined;
      await Promise.all(reservations.splice(0).map(close));
    };
    try {
      const ipv4 = await listen("0.0.0.0", 0);
      reservations.push(ipv4);
      const port = (ipv4.address() as net.AddressInfo).port;
      reservations.push(await listen("::", port));
      const ipv6 = hostname === "::1";
      other = await bindUdp(!ipv6, port);
      client = await bindUdp(ipv6, port);
      await new Promise<void>((resolve, reject) => {
        client!.once("error", reject);
        client!.connect(peer.port, hostname, resolve);
      });
      return {
        peer, client: { port }, releaseListeners,
        close: async () => { await closeUdp(client!); peer.close(); await releaseListeners(); },
      };
    } catch (error) {
      if (client) await closeUdp(client);
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
