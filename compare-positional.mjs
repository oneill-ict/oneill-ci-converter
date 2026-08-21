// Proves the positional reader against the invoice's own printed footer.
//
// This is a stronger test than diffing against the old parser: the footer
// "Goods total <qty> <amount>" is written by the ERP that produced the invoice,
// so agreeing with it means the reader got the real numbers, not the same
// numbers the old parser happened to produce.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { extractLines, readItemRows } from "./lib/invoice-rows.mjs";
import { readFooter } from "./lib/invoice-footer.mjs";

const require  = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
// The corpus is not in the repository: these are real customer invoices with names
// and addresses on them. Point CI_CORPUS_DIR at the folder to run this locally; in
// CI the test skips rather than failing, so one command covers both.
const BASE = process.env.CI_CORPUS_DIR || "C:/Users/sjoerd.lier/Downloads/ci-training-files";
if (!fs.existsSync(BASE)) {
  console.log("SKIP: facturencorpus niet aanwezig");
  process.exit(0);
}

const findPdfs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? findPdfs(p) : e.name.toLowerCase().endsWith(".pdf") ? [p] : [];
});

const round2 = (n) => Math.round(n * 100) / 100;
const pad    = (s, n) => String(s).padEnd(n).slice(0, n);

let pass = 0, fail = 0, noFooter = 0, noTable = 0;
const failures = [];

for (const file of findPdfs(BASE).sort()) {
  const name = path.basename(file);
  const buf  = fs.readFileSync(file);

  let lines;
  try {
    lines = await extractLines(buf, pdfParse);
  } catch (e) {
    failures.push({ name, why: `read error: ${e.message}` });
    fail++; continue;
  }

  const { rows, skipped, unplaced, missingColumns } = readItemRows(lines);
  if (missingColumns) { console.log(`  FAIL ${pad(name,44)} kolommen ontbreken: ${missingColumns.join(", ")}`); fail++; failures.push({name, why:"kolommen ontbreken: "+missingColumns.join(", ")}); continue; }
  const { qty: expQty, total: expTotal } = readFooter(lines);

  if (rows.length === 0) {
    console.log(`${pad(name, 46)} ${pad("— no item table", 30)}`);
    noTable++; continue;
  }

  const gotQty   = rows.reduce((s, r) => s + r.quantity, 0);
  const gotTotal = round2(rows.reduce((s, r) => s + r.total, 0));

  if (expQty == null || expTotal == null) {
    console.log(`${pad(name, 46)} ${rows.length} rows  qty=${gotQty} total=${gotTotal}  (geen footer om tegen te toetsen)`);
    noFooter++; continue;
  }

  const qtyOk   = gotQty === expQty;
  // The printed unit price is rounded to 2 decimals but the line total is computed
  // from the unrounded price, so the footer can differ from the sum of the printed
  // line totals by up to half a cent per such line. Deriving the tolerance from the
  // number of affected lines keeps it tight enough that a missing line — worth
  // whole francs — still fails.
  const roundedLines = rows.filter(r => r.price != null &&
    Math.abs(round2(r.quantity * r.price - r.discount) - r.total) > 0.001).length;
  // Compared in whole cents: at 0.03 vs a 0.03 bound, binary floating point puts
  // the difference 2e-13 over and the check fails on noise rather than on money.
  const cents = (n) => Math.round(n * 100);
  const totalOk = Math.abs(cents(gotTotal) - cents(expTotal)) <= roundedLines * 0.5 + 1;
  const skipNote = (skipped.length ? `  overgeslagen:${skipped.length}` : "") + (unplaced ? `  losse runs:${unplaced}` : "");

  if (qtyOk && totalOk) {
    console.log(`  OK   ${pad(name, 44)} ${rows.length} rows  qty=${gotQty}/${expQty}  total=${gotTotal}/${expTotal}${skipNote}`);
    pass++;
  } else {
    console.log(`  FAIL ${pad(name, 44)} ${rows.length} rows  qty=${gotQty}/${expQty}  total=${gotTotal}/${expTotal}${skipNote}`);
    failures.push({ name, expQty, gotQty, expTotal, gotTotal, rows: rows.length, skipped });
    fail++;
  }
}

console.log("\n" + "=".repeat(74));
console.log(`geslaagd ${pass}   gefaald ${fail}   geen footer ${noFooter}   geen itemtabel ${noTable}`);

for (const f of failures) {
  console.log(`\n--- ${f.name} ---`);
  if (f.why) { console.log("  " + f.why); continue; }
  console.log(`  qty   ${f.gotQty} vs ${f.expQty}   (${f.gotQty - f.expQty})`);
  console.log(`  total ${f.gotTotal} vs ${f.expTotal}   (${round2(f.gotTotal - f.expTotal)})`);
  for (const s of (f.skipped || []).slice(0, 6)) console.log(`  skip [${s.reason}] ${s.text}`);
}
