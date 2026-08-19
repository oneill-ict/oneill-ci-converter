// The invoice prints the unit price to two decimals but bills at more. A line of
// 4 at a true 79,005 shows "79,01" and totals 316,02, while 4 x 79,01 = 316,04.
// That gap is display rounding, at most half a cent per piece, so the tolerance
// has to scale with quantity. A flat figure was wrong in both directions.
// Run: node test-qty-tolerance.mjs
const qtyTolerance = (qty) => Math.abs(qty) * 0.005 + 0.001;

const CASES = [
  // [name, qty, gap between qty*price and the stated total, should be accepted]

  // Real lines from CI CH B2C 03-08-26.pdf that a flat 0.02 wrongly flagged.
  ["1800405: 4 x 79,005 shown as 79,01", 4, 0.02, true],
  ["1800421: 4 x 41,535 shown as 41,54", 4, 0.02, true],
  ["1300140: 2 x 28,825 shown as 28,83", 2, 0.01, true],

  // The boundary itself, from both sides.
  ["1 piece, half a cent",               1, 0.005, true],
  ["1 piece, a whole cent",              1, 0.01,  false],
  ["2 pieces, one cent",                 2, 0.01,  true],
  ["2 pieces, two cents",                2, 0.02,  false],
  ["10 pieces, five cents",             10, 0.05,  true],
  ["10 pieces, six cents",              10, 0.06,  false],
  ["100 pieces, fifty cents",          100, 0.50,  true],

  // What a flat 0.02 would have let through unnoticed on a large line.
  ["10 pieces, four cents off",         10, 0.04,  true],
  ["5 pieces, three cents off",          5, 0.03,  false],
];

let pass = 0, fail = 0;
for (const [name, qty, gap, shouldAccept] of CASES) {
  const accepted = gap <= qtyTolerance(qty);
  const ok = accepted === shouldAccept;
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`        qty=${qty} gap=${gap} tolerance=${qtyTolerance(qty).toFixed(4)} -> ${accepted ? "accepted" : "flagged"}, expected ${shouldAccept ? "accepted" : "flagged"}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
