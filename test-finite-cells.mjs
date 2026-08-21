// A non-finite number reaches ExcelJS as <v>NaN</v> in a numeric cell, which is
// not valid SpreadsheetML: Excel opens the file with the "we found a problem
// with some content" repair dialog. The response is still 200, so the user gets
// an unopenable attachment and no warning.
// Run: node test-finite-cells.mjs
import ExcelJS from "exceljs";
import JSZip from "jszip";

// The real guards, not copies of them. cellValue is what every data cell passes through
// and finiteOr0 is what the parsers hand it; both used to be restated here under a comment
// saying they mirrored api/convert.js, and a restatement can go green while the shipped
// code is broken.
import { cellValue as guard, finiteOr0 } from "./api/convert.js";

console.log("A. the parse fall-throughs no longer yield NaN");
const PARSES = [
  ["parseInt on letters",   () => finiteOr0(parseInt("abc", 10))],
  ["parseInt on empty",     () => finiteOr0(parseInt("", 10))],
  ["parseFloat on '0.'",    () => finiteOr0(parseFloat("0."))],
  ["parseFloat on garbage", () => finiteOr0(parseFloat("0.xyz"))],
  ["division by zero",      () => finiteOr0(1 / 0)],
];
let fail = 0;
for (const [name, fn] of PARSES) {
  const v = fn();
  const ok = Number.isFinite(v);
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(22)} -> ${v}`);
}

console.log("\nB. what ExcelJS writes, guarded vs unguarded");
async function sheetXml(values) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  values.forEach((v, i) => { ws.getCell(i + 1, 1).value = v; });
  const buf = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buf);
  return zip.files["xl/worksheets/sheet1.xml"].async("string");
}

const hostile = [NaN, Infinity, -Infinity];
const rawXml   = await sheetXml(hostile);
const safeXml  = await sheetXml(hostile.map(guard));

const rawHasNaN  = /<v>(NaN|Infinity|-Infinity)<\/v>/.test(rawXml);
const safeHasNaN = /<v>(NaN|Infinity|-Infinity)<\/v>/.test(safeXml);

console.log(`  ${rawHasNaN  ? "ok  " : "FAIL"}  unguarded writes an invalid numeric cell   (that is the bug)`);
console.log(`  ${!safeHasNaN ? "ok  " : "FAIL"}  guarded writes no invalid numeric cell`);
if (!rawHasNaN) fail++;
if (safeHasNaN) fail++;

console.log("\nC. the guard leaves legitimate values alone");
const KEEP = [0, -1, 3.14, 1e12, "", "text", null, undefined, { formula: "SUM(A1:A2)", result: 3 }];
for (const v of KEEP) {
  const out = guard(v);
  const ok = Object.is(out, v);
  if (!ok) fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${JSON.stringify(v) ?? String(v)} passes through unchanged`);
}

console.log(`\n${fail ? fail + " failed" : "all passed"}`);
process.exit(fail ? 1 : 0);
