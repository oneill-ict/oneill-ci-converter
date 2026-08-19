// Runs the reader over committed slices of real invoices.
//
// Before this, the automatic tests could not read a single real invoice: the corpus is
// 45 actual customer invoices and does not belong in a repository, so a parsing
// regression was only catchable on the one laptop that has the folder. Everything else
// was synthetic, and synthetic input is written by the same person who wrote the
// parser — it agrees with the parser by construction.
//
// A fixture is the positioned text runs of a real invoice, which is exactly what the
// reader consumes, minus everything that is not table. See make-fixtures.mjs.
//
// Run: node test-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { readItemRows } from "./lib/invoice-rows.mjs";

const DIR = "test/fixtures";
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = Object.is(got, want);
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  got ${got}, want ${want}`}`);
  ok ? pass++ : fail++;
};

const files = fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort();
if (files.length === 0) { console.error("Geen fixtures gevonden."); process.exit(1); }

// The fixtures are only safe to commit because they contain nothing but table content.
// That invariant is enforced here rather than only in the generator, so a hand-added
// line fails the build instead of quietly shipping someone's address.
function isTableLine(line) {
  const t = line.runs.map(r => r.text);
  if (t.some(x => /^Item No\.?$/i.test(x))) return true;
  if (line.runs.length >= 8 && t.some(x => /^\d{10}$/.test(x))) return true;
  if (line.runs.length >= 2 && line.runs.length <= 5 && /^\d{10}$/.test(t[0])) return true;
  return false;
}

const round2 = (n) => Math.round(n * 100) / 100;
const cents  = (n) => Math.round(n * 100);

for (const file of files) {
  const fx = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
  const e  = fx.expected;
  console.log(`\n  ${fx.name} — ${fx.describes}`);

  const stray = fx.lines.filter(l => !isTableLine(l));
  eq("bevat alleen tabelregels", stray.length, 0);
  if (stray.length) console.log("         " + JSON.stringify(stray[0].runs.map(r => r.text)).slice(0, 140));

  const { rows, columns, skipped, unplaced, currency, discountPerPiece, missingColumns } =
    readItemRows(fx.lines);

  eq("aantal regels",            rows.length, e.rows);
  eq("geen kolommen ontbreken",  missingColumns ?? null, null);
  eq("kolommen gevonden",        columns.length, e.columnsFound);
  eq("kolommen benoemd",         columns.filter(c => c.key).length, e.columnsNamed);
  eq("valuta",                   currency, e.currency);
  eq("korting per stuk",         discountPerPiece, e.discountPerPiece);
  eq("regels zonder gewicht",    rows.filter(r => r.weight == null).length, e.rowsWithoutWeight);
  eq("regels zonder prijs",      rows.filter(r => r.price == null).length, e.rowsWithoutPrice);
  eq("regels met korting",       rows.filter(r => r.discount !== 0).length, e.rowsWithDiscount);
  eq("overgeslagen regels",      skipped.length, e.skipped);
  eq("losse runs",               unplaced, 0);

  // The invoice's own footer is the oracle: it was written by the ERP that produced
  // the document, so agreeing with it means the reader got the real numbers.
  const qty   = rows.reduce((s, r) => s + r.quantity, 0);
  const total = round2(rows.reduce((s, r) => s + r.total, 0));
  eq("aantal tegen de footer", qty, e.footerQuantity);

  // The printed unit price is rounded to 2 decimals while the line total comes from
  // the unrounded one, so the footer can differ from the sum of the printed line
  // totals by up to half a cent per affected line. Compared in whole cents.
  const roundedLines = rows.filter(r => r.price != null &&
    Math.abs(round2(r.quantity * r.price - r.discount) - r.total) > 0.001).length;
  const gap = Math.abs(cents(total) - cents(e.footerTotal));
  eq(`totaal tegen de footer (${gap} cent verschil, grens ${roundedLines * 0.5 + 1})`,
     gap <= roundedLines * 0.5 + 1, true);

  // Every line has to reconcile on its own terms, whichever discount convention the
  // template uses. This is what caught nothing when the price column went unnamed.
  const broken = rows.filter(r => r.price == null ||
    Math.abs(round2(r.quantity * r.price - r.discount) - r.total) > Math.abs(r.quantity) * 0.01 + 0.01);
  eq("elke regel reconstrueert zijn eigen totaal", broken.length, 0);
  if (broken.length) console.log("         " + JSON.stringify(broken[0]));

  eq("geen enkel bedrag is NaN",
     rows.some(r => [r.quantity, r.total, r.price, r.discount].some(v => typeof v === "number" && !Number.isFinite(v))), false);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald  (${files.length} facturen)`);
process.exit(fail ? 1 : 0);
