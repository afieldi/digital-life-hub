import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startForwarder } from "../src/forwarder";

let dir: string;
let upstream: Server;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dlh-fwd-"));
});
afterEach(async () => {
  await new Promise((r) => upstream?.close(r));
  rmSync(dir, { recursive: true, force: true });
});

// The forwarder pipes to a Unix socket: the runner runs in the Linux image.
describe.skipIf(process.platform === "win32")("forwarder", () => {
  it("passes model calls through to the socket, and nothing else", async () => {
    const socketPath = join(dir, "dlh.sock");
    const seen: string[] = [];
    upstream = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen.push(
          `${req.method} ${req.url} ${req.headers.authorization} ${body}`,
        );
        res.writeHead(201, { "content-type": "text/plain" });
        res.end("streamed");
      });
    });
    await new Promise<void>((r) => upstream.listen(socketPath, r));

    const fwd = await startForwarder({ socketPath, port: 0 });
    const port = (fwd.address() as AddressInfo).port;
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/model/v1/messages?beta=true`,
        {
          method: "POST",
          headers: { authorization: "Bearer dlh-run" },
          body: "{}",
        },
      );
      expect(res.status).toBe(201);
      expect(await res.text()).toBe("streamed");
      expect(seen).toEqual([
        "POST /model/v1/messages?beta=true Bearer dlh-run {}",
      ]);

      const other = await fetch(`http://127.0.0.1:${port}/run`);
      expect(other.status).toBe(404);
      expect(seen).toHaveLength(1);
    } finally {
      await new Promise((r) => fwd.close(r));
    }
  });
});
