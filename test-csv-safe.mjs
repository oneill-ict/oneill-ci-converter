// The delivered .xlsx is safe on its own: ExcelJS writes parsed text as string
// cells and Excel does not reinterpret them on open. But the leading character
// survives a Save As -> CSV, and reopening that CSV makes Excel parse it as a
// formula. Item names, colours, countries and address lines all come from the
// PDF, so that is the one route from parsed text to something executable.
// Run: node test-csv-safe.mjs
import ExcelJS from "exceljs";
import JSZip from "jszip";

// Mirrors the guard in api/convert.js.
const CSV_UNSAFE_START = /^[=+\-@\t\r]/;
const csvSafe = (v) => (typeof v === "string" && CSV_UNSAFE_START.test(v)) ? "'" + v : v;

let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log(`  ${ok ? "ok  " : "FAIL"}  ${msg}`); };

console.log("A. dangerous leading characters get neutralised");
for (const s of ["=cmd|'/C calc'!A0", "+1+1", "-1+1", "@SUM(1+1)", "\tTAB", "\rCR",
                 "=HYPERLINK(\"http://x\",\"click\")"]) {
  const out = csvSafe(s);
  check(out === "'" + s, `${JSON.stringify(s).slice(0, 34).padEnd(36)} -> prefixed`);
}

console.log("\nB. real invoice text is left alone");
for (const s of ["O'RIGINALS ANORAK JACKET", "Black Out", "Vietnam", "6210200090",
                 "HYPERFREAK FIRE 5551", "Wms Hyperfreak", "M+R Spedag Group AG",
                 "CH-4303 Kaiseraugst", "ZAZ account.no 10085-4"]) {
  check(csvSafe(s) === s, `${JSON.stringify(s).slice(0, 34).padEnd(36)} unchanged`);
}

console.log("\nC. non-strings pass through untouched");
for (const v of [0, -1, 3.14, null, undefined, { formula: "SUM(A1:A2)", result: 3 }]) {
  check(Object.is(csvSafe(v), v), `${JSON.stringify(v) ?? String(v)} unchanged`);
}
// A negative number must not be turned into text — it starts with "-" as a string would.
check(csvSafe(-42) === -42 && typeof csvSafe(-42) === "number", "-42 stays a number, not text");

console.log("\nD. the .xlsx itself was already safe — confirm, so the guard is understood as CSV-only");
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  ws.getCell(1, 1).value = "=cmd|'/C calc'!A0";        // deliberately unguarded
  const zip = await JSZip.loadAsync(await wb.xlsx.writeBuffer());
  const sheet = await zip.files["xl/worksheets/sheet1.xml"].async("string");
  check(!/<f>/.test(sheet), "no <f> element: ExcelJS does not promote a string to a formula");
  check(/t="s"/.test(sheet), "the cell is typed as a shared string");
}

console.log(`\n${fail ? fail + " failed" : "all passed"}`);
process.exit(fail ? 1 : 0);
