// The per-line amount scan used a lazy `([\d., ]+?)\s*` before the currency
// token. Both halves can match a space, so every split of a whitespace run had
// to be tried — cubic, and ~5,000 consecutive spaces exhausted the 30 s function
// budget. This pins the replacement: same answers, flat cost.
// Run: node test-scan-scaling.mjs
import { readAmountsBeforeCurrency } from "./test-batch.mjs";

// The shape that used to blow up.
const OLD = /([\d., ]+?)\s*(?<![A-Z])(?:CHF|EUR|GBP|USD|CAD)(?![A-Z])/g;
const viaOldRegex = (s) => {
  OLD.lastIndex = 0; const out = []; let m;
  while ((m = OLD.exec(s)) !== null) out.push(m[1].trim());
  return out;
};
const viaNew = (s) => readAmountsBeforeCurrency(s).map(a => a.amount);

console.log("A. identical answers on real invoice shapes");
const SHAPES = [
  ["standard CH line",        "3 30,39 CHF0,00 CHF91,17 CHF"],
  ["no per-line weight",      "1113,04 EUR0,00 EUR113,04 EUR"],
  ["half-cent price",         "4 79,01 CHF0,00 CHF316,02 CHF"],
  ["spaced GBP",              "  11.200,00 GBP  0,00 GBP  11.200,00 GBP"],
  ["footer trailing the row", "2 28,83 CHF0,00 CHF57,65 CHF Goods total226 8.429,10 CHF"],
  ["name containing CAD",     "CADET SHORTS 1113,04 EUR0,00 EUR113,04 EUR"],
  ["name containing EUR",     "EUROPA FLEECE 15 12,00 CHF0,00 CHF180,00 CHF"],
  ["thousands separators",    "18.625 418.336,66 EUR0,00 EUR418.336,66 EUR"],
  ["no currency at all",      "1 2 3 4 5"],
];
let fail = 0;
for (const [name, s] of SHAPES) {
  const a = viaOldRegex(s), b = viaNew(s);
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(24)} ${JSON.stringify(b)}${ok ? "" : "   was " + JSON.stringify(a)}`);
}

// One deliberate difference. The old pattern's `[\d., ]+?` accepted a bare space
// as an amount, so "CHF EUR GBP" yielded two empty strings — which
// parseEuropeanNumber then read as 0,00. Phantom zero amounts inflate the count
// of values found after the tariff and can push the real three out of position.
// The replacement requires an actual digit. The batch test passes 42/42 either
// way, so nothing real depended on the old behaviour.
{
  const s = "CHF EUR GBP";
  const before = viaOldRegex(s), after = viaNew(s);
  const ok = JSON.stringify(before) === '["",""]' && after.length === 0;
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${"a space is not an amount".padEnd(24)} ${JSON.stringify(after)}   (old pattern gave ${JSON.stringify(before)})`);
}

console.log("\nB. cost must stay flat as a whitespace run grows");
let worst = 0;
for (const n of [1_000, 10_000, 100_000, 500_000]) {
  const s = " ".repeat(n) + "X";
  const t = performance.now();
  viaNew(s);
  const ms = performance.now() - t;
  worst = Math.max(worst, ms);
  console.log(`  ${String(n).padStart(7)} spaces: ${ms.toFixed(1).padStart(6)} ms`);
}
// The old scan needed 70 seconds at 6,000 spaces. Anything near that is a regression.
const flat = worst < 250;
if (!flat) fail++;
console.log(`  ${flat ? "ok  " : "FAIL"}  worst ${worst.toFixed(1)} ms (the old scan took 70,455 ms at 6,000 spaces)`);

// The backward walk is capped, so a single absurd run cannot be mistaken for one amount.
console.log("\nC. the walk is bounded");
const long = "1".repeat(500) + " CHF";
const got = viaNew(long)[0] ?? "";
const bounded = got.length <= 64;
if (!bounded) fail++;
console.log(`  ${bounded ? "ok  " : "FAIL"}  a 500-digit run yields ${got.length} chars, capped at 64`);

console.log(`\n${fail ? fail + " failed" : "all passed"}`);
process.exit(fail ? 1 : 0);
