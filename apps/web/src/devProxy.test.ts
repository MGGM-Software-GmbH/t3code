// @effect-diagnostics nodeBuiltinImport:off -- Exercises real HTTP and WebSocket proxy requests.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import { createServer } from "vite-plus";
import { expect, it, vi } from "vite-plus/test";

it("preserves the browser origin and session on API and RPC WebSocket upgrades", async () => {
  const backend = NodeHttp.createServer();
  let proxy: Awaited<ReturnType<typeof createServer>> | undefined;
  await new Promise<void>((resolve, reject) => {
    backend.once("error", reject);
    backend.listen(0, "127.0.0.1", resolve);
  });
  const backendPort = (backend.address() as NodeNet.AddressInfo).port;
  vi.stubEnv("T3CODE_PORT", String(backendPort));
  vi.stubEnv("T3CODE_SINGLE_ORIGIN_DEV", "1");
  try {
    const { default: configure } = await import("../vite.config.ts");
    const config =
      typeof configure === "function"
        ? await configure({ command: "serve", mode: "test" })
        : await configure;
    proxy = await createServer({
      configFile: false,
      logLevel: "silent",
      server: { ...config.server, host: "127.0.0.1", port: 0, warmup: {}, hmr: false },
    });
    await proxy.listen();
    const proxyPort = (proxy.httpServer!.address() as NodeNet.AddressInfo).port;
    const host = `127.0.0.1:${proxyPort}`;
    for (const path of ["/ws", "/api/preview-stream/ws"]) {
      const received = new Promise<NodeHttp.IncomingMessage>((resolve) => {
        backend.once("upgrade", (incoming, socket) => {
          socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
          resolve(incoming);
        });
      });
      const request = NodeHttp.request({
        host: "127.0.0.1",
        port: proxyPort,
        path,
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          origin: `http://${host}`,
          cookie: "t3_test_session=test-session",
        },
      });
      const responded = new Promise<void>((resolve, reject) => {
        request.once("error", reject);
        request.once("response", (response) => {
          response.resume();
          resolve();
        });
      });
      request.end();
      const incoming = await received;
      await responded;
      expect(incoming.headers.host).toBe(host);
      expect(incoming.headers.origin).toBe(`http://${host}`);
      expect(incoming.headers.cookie).toBe("t3_test_session=test-session");
      expect(incoming.headers["sec-fetch-site"]).toBeUndefined();
    }
  } finally {
    vi.unstubAllEnvs();
    await proxy?.close();
    backend.close();
    backend.closeAllConnections();
  }
});
