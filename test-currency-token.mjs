// The bare-tariff fallback stops at the first currency token. A plain search
// would also stop inside a product name containing CAD / USD / EUR, cutting the
// tariff out of the search region and dropping the line.
// Run: node test-currency-token.mjs
const CUR_TOKEN = /(?<![A-Z])(?:CHF|EUR|GBP|USD|CAD)(?![A-Z])/;

const CASES = [
  // Real currency tokens — must be found.
  ["amount then currency",        "1113,04 EUR0,00 EUR113,04 EUR", true],
  ["currency after a space",      "240,00 gr 1 113,04 CHF",        true],
  ["glued to the next amount",    "113,04 EUR0,00",                true],
  ["GBP",                         "75 1.445,78 GBP",               true],
  ["USD",                         "12 340,00 USD",                 true],
  ["CAD",                         "12 340,00 CAD",                 true],

  // Product names containing the letters — must NOT be found.
  ["ARCADE contains CAD",         "ARCADE JACKET",                 false],
  ["CADET starts with CAD",       "CADET SNOW PANTS",              false],
  ["EUROPA starts with EUR",      "EUROPA FLEECE",                 false],
  ["USDA-style code",             "USDA CERTIFIED TEE",            false],
  ["GBPRO",                       "GBPRO BOARDSHORT",              false],
  ["mid-word CHF",                "ARCHFOOT SANDAL",               false],
];

let pass = 0, fail = 0;
for (const [name, input, shouldMatch] of CASES) {
  const found = CUR_TOKEN.test(input);
  const ok = found === shouldMatch;
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`        "${input}" -> ${found ? "matched" : "no match"}, expected ${shouldMatch ? "a match" : "no match"}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
