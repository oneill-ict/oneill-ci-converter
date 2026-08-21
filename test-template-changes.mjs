// What happens when the template moves?
//
// Every invoice in the corpus has the same column layout, so the corpus cannot answer
// this. The design intends the reader to refuse rather than guess, and until now that
// was a claim about the code rather than a measurement of it. This file deliberately
// breaks the layout of a real invoice and states, for each break, what the reader does.
//
// The property under test is narrow and worth naming exactly: for any layout the reader
// does not understand, the result must be either the right numbers or a visible refusal
// — never plausible wrong numbers behind a green check. A refusal counts as visible if
// the reader reports missing columns, returns no rows, records rows as skipped, leaves a
// field null, or if the totals stop agreeing with the invoice's own footer.
//
// Where the property does not hold, this file says so out loud rather than leaving the
// case out. See "Quantity en Discount van kop verwisseld" at the bottom.
//
// Run: node test-template-changes.mjs

import fs from "node:fs";
import { readItemRows } from "./lib/invoice-rows.mjs";
import { agreesWithFooter } from "./lib/invoice-footer.mjs";

const FIXTURE = "test/fixtures/n-prefix-item-numbers.json";
const base = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const footer = { qty: base.expected.footerQuantity, total: base.expected.footerTotal };

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  console.log(`    ${cond ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`);
  cond ? pass++ : fail++;
};

const clone    = () => JSON.parse(JSON.stringify(base.lines));
const isHeader = (l) => l.runs.some(r => /^Item No\.?$/i.test(r.text));
const isItem   = (l) => l.runs.length >= 8 && l.runs.some(r => /^\d{10}$/.test(r.text));

// Read a mutated sheet and describe the result in the terms the property uses.
function outcome(lines) {
  const r    = readItemRows(lines);
  const rows = r.rows;
  const agree = agreesWithFooter(
    rows.map(x => ({ quantity: x.quantity, total: x.total, price: x.price, discount: x.discount })),
    footer);
  const nullFields = rows.filter(x => x.price == null || x.weight == null).length;
  return {
    ...r, rows, agree, nullFields,
    correct: rows.length === base.expected.rows && agree.qtyOk && agree.totalOk && nullFields === 0,
    refused: !!r.missingColumns || rows.length === 0 || r.skipped.length > 0
             || !agree.qtyOk || !agree.totalOk || nullFields > 0,
  };
}

const verdict = (o) =>
  `${o.rows.length} regels, aantal ${o.agree.quantity}/${footer.qty}, ` +
  `overgeslagen ${o.skipped.length}, lege velden ${o.nullFields}` +
  (o.missingColumns ? `, kolommen ontbreken: ${o.missingColumns.join(",")}` : "");

// ── the unmutated fixture, as a baseline ────────────────────────────────────
console.log("\n  onveranderd");
{
  const o = outcome(clone());
  ok("leest correct", o.correct, verdict(o));
}

// ── the whole table moves ───────────────────────────────────────────────────
console.log("\n  hele tabel 40 punten naar rechts");
{
  // A different page margin. The grid comes from the rows themselves, so this has to
  // simply work; if it does not, the reader is secretly relying on fixed positions.
  const lines = clone();
  for (const l of lines) for (const r of l.runs) r.x += 40;
  ok("leest nog correct", outcome(lines).correct, verdict(outcome(lines)));
}

console.log("\n  kolommen ongelijk 3 punten verschoven");
{
  const lines = clone();
  for (const l of lines) l.runs.forEach((r, i) => { r.x += (i % 2 ? 3 : -3); });
  const o = outcome(lines);
  ok("leest nog correct", o.correct, verdict(o));
}

// ── a column moves out from under its header ────────────────────────────────
console.log("\n  prijskolom 30 punten opgeschoven, kop blijft staan");
{
  const lines = clone();
  const px = base.lines.find(isItem).runs[9].x;
  for (const l of lines) for (const r of l.runs) if (Math.abs(r.x - px) < 1) r.x += 30;
  const o = outcome(lines);
  ok("of correct, of zichtbaar geweigerd", o.correct || o.refused, verdict(o));
  ok("aantal en totaal blijven hoe dan ook kloppen", o.agree.qtyOk && o.agree.totalOk);
}

// ── the header is gone or renamed ───────────────────────────────────────────
console.log("\n  kolomkop volledig verwijderd");
{
  const o = outcome(clone().filter(l => !isHeader(l)));
  ok("weigert", o.refused, verdict(o));
  ok("levert geen enkele regel", o.rows.length === 0);
}

console.log("\n  Quantity heet anders in de kop");
{
  const lines = clone();
  lines.find(isHeader).runs.find(r => r.text === "Quantity").text = "Pieces shipped";
  const o = outcome(lines);
  ok("weigert", o.refused, verdict(o));
}

console.log("\n  gewichtskop heet anders (onbekend sjabloon)");
{
  const lines = clone();
  lines.find(isHeader).runs.find(r => /weight/i.test(r.text)).text = "Masse brutto";
  const o = outcome(lines);
  // Losing the weight must not cost the money columns.
  ok("aantal en totaal nog correct", o.agree.qtyOk && o.agree.totalOk, verdict(o));
  ok("gewichten zichtbaar leeg in plaats van 0", o.rows.every(r => r.weight === null),
     `${o.rows.filter(r => r.weight === null).length}/${o.rows.length}`);
}

// ── an extra column appears ─────────────────────────────────────────────────
console.log("\n  extra kolom tussen aantal en prijs");
{
  const lines = clone();
  const ref  = base.lines.find(isItem);
  const newX = (ref.runs[8].x + ref.runs[9].x) / 2;
  for (const l of lines) {
    if (isHeader(l)) { l.runs.push({ x: newX, text: "Batch" }); l.runs.sort((a, b) => a.x - b.x); continue; }
    if (!isItem(l)) continue;
    l.runs.push({ x: newX, text: "B-2231" });
    l.runs.sort((a, b) => a.x - b.x);
  }
  const o = outcome(lines);
  ok("of correct, of zichtbaar geweigerd", o.correct || o.refused, verdict(o));
  ok("aantal en totaal blijven hoe dan ook kloppen", o.agree.qtyOk && o.agree.totalOk);
}

// ── things that are not item rows ───────────────────────────────────────────
console.log("\n  proza tussen de artikelregels");
{
  const lines = clone();
  const y = base.lines.find(isItem).y;
  lines.push({ page: 1, y: y - 6, runs: [{ x: 16,
    text: "Bei Waren tuerkischen Ursprungs: Der Ausfuehrer erklaert 6110209900 dass diese Waren" }] });
  lines.push({ page: 1, y: y - 7, runs: [{ x: 16, text: "Custom clearence agent:" },
                                         { x: 200, text: "M+R Spedag Group AG" }] });
  lines.sort((a, b) => a.page - b.page || b.y - a.y);
  const o = outcome(lines);
  ok("proza wordt genegeerd", o.correct, verdict(o));
}

console.log("\n  tariefsubtotaalregels blijven buiten de artikelregels");
{
  // These carry 10-digit tariff numbers, so they are the lines most easily confused
  // with item rows. The fixture keeps them for exactly this reason.
  const o = outcome(clone());
  ok("regelaantal is het artikelaantal", o.rows.length === base.expected.rows, verdict(o));
}

// ── a broken cell in one row ────────────────────────────────────────────────
console.log("\n  een regel mist zijn totaal");
{
  const lines = clone();
  const row = lines.find(isItem);
  row.runs = row.runs.filter((r, i) => i !== 11);
  const o = outcome(lines);
  ok("die regel wordt gerapporteerd, niet stil weggelaten", o.skipped.length === 1, verdict(o));
  ok("met een reden en een artikelnummer erbij",
     !!o.skipped[0]?.reason && !!o.skipped[0]?.itemNo, JSON.stringify(o.skipped[0] ?? {}).slice(0, 90));
  ok("en het aantal klopt daardoor niet meer", !o.agree.qtyOk);
}

console.log("\n  twee cellen aan elkaar geplakt in een regel");
{
  const lines = clone();
  const row = lines.find(isItem);
  const q = row.runs[8], p = row.runs[9];
  row.runs = row.runs.filter(r => r !== p);
  q.text = q.text + p.text.replace(/\s*[A-Z]{3}$/, "");
  const o = outcome(lines);
  // The old parser guessed where to split a run like this. This one refuses the row:
  // a glued quantity-and-price cell parses to 601.04, and a quantity of pieces is
  // always whole.
  ok("de geplakte regel wordt geweigerd, niet gesplitst", o.skipped.length === 1, verdict(o));
  // The reason is a stable key for the UI to translate; the offending value rides along in
  // `detail`, because a key cannot carry a number.
  ok("de reden is de juiste sleutel", o.skipped[0]?.reason === "fractional quantity",
     o.skipped[0]?.reason ?? "");
  ok("en het aantal staat in detail", /^\d+\.\d+$/.test(o.skipped[0]?.detail ?? ""),
     o.skipped[0]?.detail ?? "(leeg)");
}

// ── the case where the property does not hold at this level ─────────────────
console.log("\n  Quantity en Discount van kop verwisseld");
{
  const lines = clone();
  const h = lines.find(isHeader);
  const q = h.runs.find(r => r.text === "Quantity");
  const d = h.runs.find(r => r.text === "Discount");
  [q.text, d.text] = [d.text, q.text];
  const o = outcome(lines);
  // The reader believes the header, so it reads the discount column as the quantity and
  // has no way to know better. At this level that is wrong data rather than a refusal.
  // What catches it is the invoice's own footer, one layer up — which is why the handler
  // never ships rows it has not compared against that footer, and why "the reader
  // refuses" is only true of the two together.
  ok("de lezer zelf ziet dit niet aankomen", !o.missingColumns);
  ok("maar de footer van de factuur vangt het", !o.agree.qtyOk || !o.agree.totalOk,
     `aantal ${o.agree.quantity} tegen ${footer.qty}`);
}


// ── A template built from scratch, not a mutation of the one that passes ─────
// Every invoice in the corpus is one layout, so mutating it only ever asks "what if this
// moved". These two ask the harder question: what happens to a table this reader has never
// seen, laid out the way another supplier's ERP might lay it out.
//
// Built by hand rather than derived, so it cannot inherit anything that makes the corpus
// work: different column order, different page width, different row spacing.
const L2 = (y, ...pairs) => ({ page: 1, y, runs: pairs.map(([x, text]) => ({ x, text })) });

console.log("\n  een ander sjabloon met dezelfde koppen, maar de kolommen in een andere orde");
{
  // Quantity before the description, total before the price, on a narrower page.
  const header = L2(700,
    [10, "Item No."], [60, "Quantity"], [95, "Item"], [260, "Colour"], [330, "Colour no."],
    [380, "Item group"], [430, "Country of origin"], [500, "Tariff No."],
    [560, "Nett weight"], [610, "Total"], [670, "Price per piece"], [720, "Discount"]);
  const row = (n, qty, price, total) => L2(688 - n * 9,
    [10, `21${n}0055`], [60, String(qty)], [95, "SOME PRODUCT NAME"], [260, "Black Out"],
    [330, "19010"], [380, "Jackets"], [430, "Vietnam"], [500, "6210200090"],
    [560, "410,00 gr"], [610, `${total.toFixed(2).replace(".", ",")} GBP`],
    [670, `${price.toFixed(2).replace(".", ",")} GBP`], [720, "0,00 GBP"]);
  const lines = [header, row(0, 3, 10, 30), row(1, 2, 25, 50), row(2, 5, 4, 20), row(3, 1, 9, 9)];

  const r = readItemRows(lines);
  const agree = agreesWithFooter(
    r.rows.map(x => ({ quantity: x.quantity, total: x.total, price: x.price, discount: x.discount })),
    { qty: 11, total: 109 });
  ok("alle vier de regels gelezen", r.rows.length === 4, `${r.rows.length} regels`);
  ok("aantal klopt", agree.qtyOk, `${agree.quantity} van 11`);
  ok("totaal klopt", agree.totalOk, `${agree.total} van 109`);
  ok("de valuta komt uit de cellen", r.currency === "GBP", String(r.currency));
  ok("de kolomorde maakt niets uit", r.rows[0].itemNo === "2100055" && r.rows[0].quantity === 3,
     `${r.rows[0].itemNo} / ${r.rows[0].quantity}`);
}

console.log("\n  een ander sjabloon met andere koptekst — dat moet weigeren, niet half lezen");
{
  // "HS Code" and "Amount" instead of "Tariff No." and "Total": plausible wording from
  // another ERP, and not something this reader knows.
  const header = L2(700,
    [10, "Article"], [60, "Description"], [300, "Qty"], [340, "HS Code"],
    [400, "Weight"], [450, "Unit price"], [510, "Amount"]);
  const row = (n) => L2(688 - n * 9,
    [10, `31${n}0055`], [60, "SOME PRODUCT"], [300, "4"], [340, "6210200090"],
    [400, "410,00 gr"], [450, "10,00 GBP"], [510, "40,00 GBP"]);
  const lines = [header, row(0), row(1), row(2), row(3)];

  const r = readItemRows(lines);
  ok("weigert", r.rows.length === 0, `${r.rows.length} regels`);
  ok("en niets half gelezen", r.skipped.length === 0, `${r.skipped.length} overgeslagen`);

  // It cannot say which columns are missing here, and that is worth stating rather than
  // asserting away: a row needs at least eight cells to count as an item row at all, which
  // is what separates them from the two-and-three-cell tariff subtotal rows underneath. This
  // template has seven columns, so no row is ever recognised, so there is no grid to find a
  // gap in. The user gets "no invoice lines found — is this an O'Neill Commercial Invoice?",
  // which is true and actionable, but less precise than the named-column refusal a
  // twelve-column template with one bad header produces.
  ok("kolommen ontbreken wordt hier niet gemeld", r.missingColumns == null,
     JSON.stringify(r.missingColumns ?? null));

  // The precise refusal, for contrast: same widths as the real template, one header renamed.
  const wide = (y, ...pairs) => ({ page: 1, y, runs: pairs.map(([x, t2]) => ({ x, text: t2 })) });
  const hdr2 = wide(700, [10, "Item No."], [60, "Item"], [230, "Colour"], [330, "Colour no."],
    [380, "Item group"], [430, "Country of origin"], [500, "HS Code"], [560, "Nett weight"],
    [610, "Quantity"], [660, "Price per piece"], [710, "Discount"], [760, "Total"]);
  const row2 = (n) => wide(688 - n * 9, [10, `41${n}0055`], [60, "SOME PRODUCT"],
    [230, "Black Out"], [330, "19010"], [380, "Jackets"], [430, "Vietnam"], [500, "6210200090"],
    [560, "410,00 gr"], [610, "4"], [660, "10,00 GBP"], [710, "0,00 GBP"], [760, "40,00 GBP"]);
  const r2 = readItemRows([hdr2, row2(0), row2(1), row2(2), row2(3)]);
  ok("met twaalf kolommen noemt hij de ontbrekende wel",
     Array.isArray(r2.missingColumns) && r2.missingColumns.includes("tariffNo"),
     JSON.stringify(r2.missingColumns ?? null));
  ok("en levert ook dan niets af", r2.rows.length === 0, `${r2.rows.length}`);
}

console.log(`
${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
