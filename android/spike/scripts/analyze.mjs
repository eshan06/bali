// Reads a capture of `adb logcat -v epoch` and times each timing.sh run: from the launch (the
// system's START line) and from the app's first frame (its Displayed line, cold starts only) to
// the cover drawn on it. node analyze.mjs <logcat.txt> [label]
import { readFileSync } from "node:fs";

const [file, only] = process.argv.slice(2);
const lines = readFileSync(file, "latin1").split(/\r?\n/);
const parsed = [];
for (const raw of lines) {
  const m = raw.match(/^\s*(\d+\.\d+)\s+\d+\s+\d+\s+[VDIWEF]\s+([^:]+?)\s*: (.*)$/);
  if (m) parsed.push({ t: Number(m[1]) * 1000, tag: m[2], msg: m[3] });
}
const runs = [];
for (let i = 0; i < parsed.length; i++) {
  const run = parsed[i].msg.match(/^RUN label=(\S+) pkg=(\S+) i=(\d) kind=(\S+)/);
  if (!run || parsed[i].tag !== "BaliSpikeTest") continue;
  const [, label, pkg, n, kind] = run;
  if (only && label !== only) continue;
  let start, displayed, drawn, check;
  for (let j = i + 1; j < parsed.length; j++) {
    const { t, tag, msg } = parsed[j];
    if (tag === "BaliSpikeTest" && msg.startsWith("CHECK")) { check = msg.match(/covers=(\d+)/)?.[1]; break; }
    if (!start && tag === "ActivityTaskManager" && msg.startsWith("START u0") && msg.includes(`cmp=${pkg}/`)) start = t;
    if (!displayed && tag === "ActivityTaskManager" && msg.startsWith(`Displayed ${pkg}/`)) displayed = t;
    if (!drawn && tag === "BaliSpike" && msg.startsWith("cover-drawn") && msg.includes(`pkg=${pkg} `)) drawn = t;
  }
  runs.push({ label, pkg, n, kind, start, displayed, drawn, check });
}
const fmt = (v) => (v === undefined ? "-" : String(Math.round(v)));
console.log("label\tpkg\trun\tkind\tstart→cover\tframe→cover\tcovers");
for (const r of runs) {
  const s = r.drawn && r.start ? r.drawn - r.start : undefined;
  const d = r.drawn && r.displayed ? r.drawn - r.displayed : undefined;
  r.s = s;
  r.d = d;
  console.log([r.label, r.pkg.split(".").pop(), r.n, r.kind, fmt(s), fmt(d), r.check].join("\t"));
}
const stats = (xs) => {
  const v = xs.filter((x) => x !== undefined).sort((a, b) => a - b);
  if (!v.length) return "-";
  return `median ${fmt(v[Math.floor(v.length / 2)])}, worst ${fmt(v.at(-1))}, n=${v.length}`;
};
for (const label of [...new Set(runs.map((r) => r.label))]) {
  const rs = runs.filter((r) => r.label === label);
  const warm = rs.filter((r) => r.kind === "warm");
  console.log(`${label}: launch→cover ${stats(rs.map((r) => r.s))}; warm (the app's window shows at once) ${stats(warm.map((r) => r.s))}; cold, first frame→cover ${stats(rs.map((r) => r.d))}; uncovered ${rs.filter((r) => r.check === "0").length}/${rs.length}`);
}
