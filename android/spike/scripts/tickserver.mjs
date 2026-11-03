// The host end of the spike's check-in tick: the emulator reaches the host at 10.0.2.2, a real
// phone at the PC's address on the same Wi-Fi. Prints one line per tick, with the host's clock.
//   node tickserver.mjs [port]   (default 8787)
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8787);
createServer((req, res) => {
  const url = new URL(req.url, "http://host");
  console.log(`${Date.now()} ${req.socket.remoteAddress} ${url.pathname} ${url.searchParams}`);
  res.end("ok");
}).listen(port, "0.0.0.0", () => console.log(`${Date.now()} listening on ${port}`));
