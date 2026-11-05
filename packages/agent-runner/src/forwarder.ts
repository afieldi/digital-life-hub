import { createServer, request, type Server } from "node:http";
import { SOCKET_PATH } from "./host";

/** Where `ANTHROPIC_BASE_URL` points: `http://127.0.0.1:8788/model` (D3). */
export const FORWARDER_PORT = 8788;

/**
 * The SDK needs an `http://` base URL, so model calls go to loopback and are
 * piped, untouched and streaming, to the run's socket. Only `/model/*` passes;
 * the other routes are the runner's own.
 */
export function startForwarder(
  opts: { socketPath?: string; port?: number } = {},
): Promise<Server> {
  const socketPath = opts.socketPath ?? SOCKET_PATH;
  const server = createServer((req, res) => {
    if (!req.url?.startsWith("/model/")) {
      res.writeHead(404).end();
      return;
    }
    const upstream = request(
      { socketPath, method: req.method, path: req.url, headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // The SDK hanging up mid-stream stops the call upstream too.
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? FORWARDER_PORT, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
