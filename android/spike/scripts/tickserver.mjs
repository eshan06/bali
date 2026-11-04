// The host end of the spike's check-in tick: the emulator reaches the host at 10.0.2.2, a real
// phone at the PC's address on the same Wi-Fi. Prints one line per tick, with the host's clock.
// For lock (c), the stand-in app's /probe (answered, not printed) and /stream (a line every
// 100 ms until the phone hangs up; its open and close printed).
//   node tickserver.mjs [port]   (default 8787)
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8787);
createServer((req, res) => {
  const url = new URL(req.url, "http://host");
  if (url.pathname === "/probe") return res.end("ok");
  console.log(`${Date.now()} ${req.socket.remoteAddress} ${url.pathname} ${url.searchParams}`);
  if (url.pathname !== "/stream") return res.end("ok");
  res.writeHead(200, { "Content-Type": "text/plain" });
  const every = setInterval(() => res.write(`${Date.now()} ${"x".repeat(100)}\n`), 100);
  res.on("close", () => {
    clearInterval(every);
    console.log(`${Date.now()} stream closed`);
  });
}).listen(port, "0.0.0.0", () => console.log(`${Date.now()} listening on ${port}`));
