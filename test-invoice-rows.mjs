// Unit tests for lib/invoice-rows.mjs.
//
// The property under test is refusal: a cell the parser does not fully understand
// must come back null, not a plausible number. An earlier draft accepted
// "380,00 gr" as 380 in the quantity column and produced a wrong quantity on six
// invoices while every total still looked right — the exact silent-wrongness this
// module exists to prevent.

import { parseAmount, parseWeight, buildGrid } from "./lib/invoice-rows.mjs";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = Object.is(got, want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  got ${got}, want ${want}`}`);
  ok ? pass++ : fail++;
};

console.log("parseAmount accepts real money");
eq('"19,94"',           parseAmount("19,94"),           19.94);
eq('"19,94 CHF"',       parseAmount("19,94 CHF"),       19.94);
eq('"1.234,56 EUR"',    parseAmount("1.234,56 EUR"),    1234.56);
eq('"418.336,66"',      parseAmount("418.336,66"),      418336.66);
eq('"0,00"',            parseAmount("0,00"),            0);
eq('"-17,39 CHF"',      parseAmount("-17,39 CHF"),      -17.39);
eq('"1"',               parseAmount("1"),               1);
eq('"226"',             parseAmount("226"),             226);

console.log("parseAmount refuses everything else");
eq('"380,00 gr"',       parseAmount("380,00 gr"),       null);
eq('"380,00 gr 1"',     parseAmount("380,00 gr 1"),     null);
eq('"19,94 CHF 0,00"',  parseAmount("19,94 CHF 0,00"),  null);
eq('"China"',           parseAmount("China"),           null);
eq('"4202929890 380"',  parseAmount("4202929890 380"),  null);
eq('"19,944"',          parseAmount("19,944"),          null);
eq('"1,234.56"',        parseAmount("1,234.56"),        null);
eq('""',                parseAmount(""),                null);
eq("null",              parseAmount(null),              null);
eq("undefined",         parseAmount(undefined),         null);

console.log("parseWeight reads the weight column only");
eq('"380,00 gr"',       parseWeight("380,00 gr"),       380);
eq('"2400 gr"',         parseWeight("2400 gr"),         2400);
eq('"1,50 kg"',         parseWeight("1,50 kg"),         1500);
eq('"1"',               parseWeight("1"),               null);
eq('"19,94 CHF"',       parseWeight("19,94 CHF"),       null);
eq('""',                parseWeight(""),                null);

console.log("buildGrid needs recurring columns, not stray runs");
const row = (y, xs) => ({ page: 1, y, runs: xs.map(x => ({ x, text: x === 505 ? "4202929890" : "x" })) });
const cols = [16, 69, 225, 332, 385, 445, 505, 565, 625, 670, 715, 775];
const grid = buildGrid([row(700, cols), row(687, cols), row(674, cols), row(661, cols)]);
eq("twelve columns from four identical rows", grid.length, 12);
eq("first column at x=16", grid[0].x, 16);
// A run appearing on one row out of four is below the half-of-rows threshold.
const withStray = buildGrid([row(700, [...cols, 900]), row(687, cols), row(674, cols), row(661, cols)]);
eq("a one-off run is not a column", withStray.length, 12);
eq("no item rows means no grid", buildGrid([]).length, 0);

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
