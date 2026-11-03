// Ticks in a log window: how many, the widest gap, how many reached the host, and whether the
// phone was idle and its CPU slept. node ticks.mjs <logcat.txt> <fromEpochS> <toEpochS>
import { readFileSync } from "node:fs";

const [file, from, to] = process.argv.slice(2);
const ticks = [];
let sent = 0;
let failed = 0;
for (const raw of readFileSync(file, "latin1").split(/\r?\n/)) {
  const m = raw.match(/^\s*(\d+\.\d+)\s.*BaliSpike: (tick|tick-sent|tick-send-failed) (.*)$/);
  if (!m || Number(m[1]) < Number(from) || Number(m[1]) > Number(to)) continue;
  if (m[2] === "tick-sent") sent++;
  else if (m[2] === "tick-send-failed") failed++;
  else {
    const field = (k) => m[3].match(new RegExp(`${k}=(\\S+)`))?.[1];
    ticks.push({ t: Number(m[1]), gap: Number(field("gapMs")), slept: Number(field("sleptMs")), idle: field("deviceIdle") });
  }
}
const gaps = ticks.map((t) => t.gap);
console.log(
  `ticks ${ticks.length} (expected ${Math.floor((to - from) / 30)}), widest gap ${Math.max(...gaps)} ms, ` +
    `idle on ${ticks.filter((t) => t.idle === "true").length}, slept ${Math.max(...ticks.map((t) => t.slept))} ms, ` +
    `sent ${sent}, failed ${failed}`,
);
