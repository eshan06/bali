// Reads a uiautomator dump on stdin; prints the centre "x y" of the first node whose text or
// content-desc matches the pattern (a regular expression, case-insensitive). Exit 1: none.
const pattern = new RegExp(process.argv[2], "i");
let xml = "";
process.stdin.on("data", (chunk) => (xml += chunk));
process.stdin.on("end", () => {
  for (const node of xml.match(/<node [^>]*>/g) ?? []) {
    const attr = (name) => node.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
    if (!pattern.test(attr("text")) && !pattern.test(attr("content-desc"))) continue;
    const [x1, y1, x2, y2] = attr("bounds").match(/\d+/g).map(Number);
    console.log(`${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
    process.exit(0);
  }
  process.exit(1);
});
