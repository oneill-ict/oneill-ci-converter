// Tests the workbook the converter hands over.
//
// Everything up to here tested the reading. The writing — 350 lines deciding what a
// customs document actually says — was verified by my opening one in Excel and looking
// at it. That is not a test, and it is the layer nobody else can check afterwards:
// once the file is on a colleague's disk, the numbers in it are the numbers.
//
// The invoice fed in is built from a committed fixture, so the rows are real.
//
// Run: node test-workbook.mjs

import fs from "node:fs";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { buildExcel } from "./api/convert.js";
import { readItemRows } from "./lib/invoice-rows.mjs";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = Object.is(got, want);
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

function invoiceFrom(fixtureName, extra = {}) {
  const fx = JSON.parse(fs.readFileSync(`test/fixtures/${fixtureName}.json`, "utf8"));
  const { rows, currency } = readItemRows(fx.lines);
  return {
    fixture: fx,
    invoice: {
      date: "27-04-2025", orderNumber: "3583511", deliveryTerms: "DDP Kilmuckridge",
      numberOfBoxes: "8", grossWeight: "65.400,00 gr",
      billingName: "Testklant", billingAddress: ["Teststraat 1", "1234 AB Teststad"],
      currency, invoiceDiscount: 0, vat: 0, isB2B: false, creditNote: false,
      items: rows.map(r => ({
        itemNo: r.itemNo, item: r.item, colour: r.colour, colourNo: r.colourNo,
        country: r.country, tariffNo: r.tariffNo, grossWeight: r.weight,
        quantity: r.quantity, pricePerPiece: r.price, discount: r.discount, total: r.total,
      })),
      _validation: null,
      ...extra,
    },
  };
}

// Read cached formula results out of the XML rather than through ExcelJS. Its reader
// drops a result of 0 on load — the file has <v>0</v>, the reader returns undefined —
// which would make a difference cell of zero indistinguishable from a missing one.
async function cachedValues(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const out = new Map();
  for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<f>([^<]*)<\/f>)?(?:<v>([^<]*)<\/v>)?/g)) {
    out.set(m[1], { formula: m[2] ?? null, value: m[3] ?? null });
  }
  return { cells: out, xml };
}

// ch-b2c-172-rows is in this list for a specific reason: it has 30 tariff codes, enough
// for the tariff block to reach down into the legal footer. Without it, a footer written
// over the check rows passes every other fixture.
for (const name of ["n-prefix-item-numbers", "per-piece-discounts", "weightless-template",
                    "large-quantities", "ch-b2c-172-rows"]) {
  const { fixture, invoice } = invoiceFrom(name);
  const buffer = await buildExcel(invoice);
  const { cells, xml } = await cachedValues(buffer);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  console.log(`\n  ${name}`);

  eq("de werkmap opent", ws.rowCount > 0, true);

  // Find the tariff block by its heading rather than by a row number.
  let tariffHead = null;
  ws.eachRow((row, n) => {
    if (String(row.getCell(1).value ?? "").startsWith("SUBTOTAL TARIFF")) tariffHead = n;
  });
  eq("het tariefblok staat er", tariffHead != null, true);

  const label = (n) => String(ws.getRow(n).getCell(1).value ?? "");
  let diffRow = null;
  for (let n = tariffHead; n < tariffHead + 200; n++) if (label(n) === "Difference") diffRow = n;
  eq("er is een verschilrij", diffRow != null, true);

  // All three check rows have to survive whatever is written below them. The legal footer
  // used to start at a row derived from the tariff count and overwrote two of them on any
  // invoice with enough codes to reach that far.
  eq("de drie controlerijen staan er alle drie",
     [label(diffRow - 2), label(diffRow - 1), label(diffRow)].join("|"),
     "Tariff total|Invoice total|Difference");

  // The three cached zeros. A non-zero here means the breakdown does not account for
  // the whole invoice — the failure a misread tariff column would cause.
  for (const col of ["B", "C", "D"]) {
    const c = cells.get(`${col}${diffRow}`);
    eq(`${col}: verschil is nul`, c?.value, "0");
    eq(`${col}: en het is een formule, geen gedrukte nul`, /^[BCD]\d+-[BCD]\d+$/.test(c?.formula ?? ""), true);
  }

  // The breakdown against the invoice, read from the cached results.
  const totalRow = diffRow - 2, invoiceRow = diffRow - 1;
  eq("tarieftotaal = factuurtotaal",
     cells.get(`B${totalRow}`)?.value, cells.get(`B${invoiceRow}`)?.value);
  eq("regels bij de tarieven = regels in de factuur",
     Number(cells.get(`C${totalRow}`)?.value), invoice.items.length);
  eq("stuks bij de tarieven = stuks in de factuur",
     Number(cells.get(`D${totalRow}`)?.value),
     invoice.items.reduce((s, i) => s + i.quantity, 0));

  // The currency in the tariff header, which used to be hardcoded CHF on every invoice.
  eq(`kop noemt ${invoice.currency}`,
     String(ws.getRow(tariffHead + 1).getCell(2).value ?? ""), `Subtotal (${invoice.currency})`);

  // SUMIF coerces a numeric-looking text criteria to a number and silently returns
  // zero once Excel recalculates. Every grouping formula must avoid it.
  eq("geen enkele SUMIF of COUNTIF in het bestand", /(?:<f>[^<]*)(?:SUMIF|COUNTIF)/.test(xml), false);

  // The Total column carries the invoice's own line total as a value. Recomputing it
  // from a rounded unit price drifted a cent per line — 12 cents over 172 lines.
  const dataStart = 19;
  const firstItem = ws.getRow(dataStart);
  eq("regeltotaal is een waarde, geen formule",
     typeof firstItem.getCell(11).value, "number");
  eq("en het is het regeltotaal van de factuur",
     firstItem.getCell(11).value, invoice.items[0].total);

  // Gross weight: an unknown must stay empty rather than be declared as 0.
  const weightCells = [];
  for (let n = dataStart; n < dataStart + invoice.items.length; n++) {
    weightCells.push(ws.getRow(n).getCell(7).value);
  }
  const expectEmpty = fixture.expected.rowsWithoutWeight;
  eq("onbekend gewicht blijft leeg, nooit 0",
     weightCells.filter(v => v === null || v === undefined || v === "").length, expectEmpty);
  eq("geen enkel gewicht is een verklaarde nul",
     weightCells.some(v => v === 0), false);

  // A NaN in a numeric cell is not valid SpreadsheetML and makes Excel offer to repair
  // the file — a 200 OK with an unopenable attachment.
  eq("nergens NaN in het bestand", /<v>NaN<\/v>/.test(xml), false);
}

// ── The layout variant with an invoice-level discount ─────────────────────────
// A discount adds a row to the summary block, which sits between the item rows and the
// tariff block, so every row number the tariff formulas use moves down by one. The
// breakdown still has to add up.
//
// It does not move the Goods total row itself — that sits above the discount row — so
// this does not test the gtRow reference. No test can: gtRow and lastRow + 2 are the
// same row by construction, which is why swapping one for the other changed nothing
// here. That edit removed a duplicated offset, not a bug.
console.log("\n  factuur met korting: alle rijnummers eronder schuiven");
{
  const { invoice } = invoiceFrom("n-prefix-item-numbers", { invoiceDiscount: 25.5 });
  const { cells } = await cachedValues(await buildExcel(invoice));
  let diffRow = null;
  for (const [ref, c] of cells) {
    const m = /^B(\d+)$/.exec(ref);
    if (m && /^B\d+-B\d+$/.test(c.formula ?? "")) diffRow = Number(m[1]);
  }
  eq("er is nog een verschilrij", diffRow != null, true);
  eq("en die is nog steeds nul", cells.get(`B${diffRow}`)?.value, "0");
  const invoiceRow = diffRow - 1;
  eq("verwijst nog naar een cel in kolom K",
     /^K\d+$/.test(cells.get(`B${invoiceRow}`)?.formula ?? ""), true);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
