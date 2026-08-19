// The handler used to pass req.body.pdf straight to Buffer.from, which accepts
// anything array-like and then ignores the "base64" argument. A 28-byte body
// could name a 191 MB allocation. These are the shapes that must be refused
// before the decoder sees them.
// Run: node test-request-input.mjs
const MAX_BASE64_CHARS = 7_000_000;

// Mirrors the guard in api/convert.js.
function guard(pdf) {
  if (!pdf) return { status: 400, why: "empty" };
  if (typeof pdf !== "string") return { status: 400, why: "not a string" };
  if (pdf.length > MAX_BASE64_CHARS) return { status: 413, why: "too large" };
  return { status: 200, why: "accepted" };
}

const CASES = [
  // [name, value, expected status]
  ["a real base64 string",            "JVBERi0xLjQK",                     200],
  ["a large but legal string",        "A".repeat(1_000_000),              200],

  // The type-confusion shapes.
  ["object with a length",            { length: 200_000_000 },            400],
  ["object with a small length",      { length: 10 },                     400],
  ["array of bytes",                  [37, 80, 68, 70],                   400],
  ["typed array",                     new Uint8Array([37, 80]),           400],
  ["nested object",                   { pdf: "x" },                       400],
  ["boolean",                         true,                               400],

  // Falsy — caught by the earlier check.
  ["empty string",                    "",                                 400],
  ["null",                            null,                               400],
  ["undefined",                       undefined,                          400],
  ["zero",                            0,                                  400],

  // Oversized.
  ["8 M chars of base64",             "A".repeat(8_000_000),              413],
];

let pass = 0, fail = 0;
for (const [name, val, want] of CASES) {
  const got = guard(val);
  const ok = got.status === want;
  if (ok) { pass++; console.log(`  ok    ${String(want).padEnd(3)} ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}: expected ${want}, got ${got.status} (${got.why})`);
  }
}

// And the thing the guard exists to prevent: prove Buffer.from really does this.
const b = Buffer.from({ length: 1000 }, "base64");
const arrayLikeIsAccepted = b.length === 1000;
console.log(`\n  ${arrayLikeIsAccepted ? "ok  " : "FAIL"}  Buffer.from({length:1000},"base64") yields ${b.length} bytes — the reason the guard exists`);
if (!arrayLikeIsAccepted) fail++;

console.log(`\n${pass + (arrayLikeIsAccepted ? 1 : 0)} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
