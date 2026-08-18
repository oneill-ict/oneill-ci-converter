// Unit tests for readGoodsTotal — the footer reader that decides whether an
// invoice gets validated at all. Run: node test-goods-total.mjs
import { readGoodsTotal } from "./test-batch.mjs";

const CASES = [
  // ── The two real layouts ──────────────────────────────────────────────────
  ["spaced layout",
   "Goods total226 8.429,10 CHF Subtotal8.429,10 CHF",
   { qty: 226, total: 8429.10 }],
  ["glued layout",
   "Goods total2913.304,16 EUR Subtotal3.304,16 EUR VAT0,00 EUR",
   { qty: 291, total: 3304.16 }],
  ["glued with discount",
   "Goods total15487,34 EUR Discount487,34 EUR Subtotal0,00 EUR",
   { qty: 15, total: 487.34 }],
  ["glued, amount without thousands separator",
   "Goods total4399,98 EUR Discount399,98 EUR Subtotal0,00 EUR",
   { qty: 4, total: 399.98 }],
  ["leading-zero rule keeps the split unique",
   "Goods total501.155,47 EUR Subtotal1.155,47 EUR",
   { qty: 50, total: 1155.47 }],
  ["zero-value invoice",
   "Goods total30,00 EUR Subtotal0,00 EUR",
   { qty: 3, total: 0 }],

  // ── Hazards found in the re-audit ─────────────────────────────────────────
  ["tariff table must not be read as the footer",
   "Goods total2913.304,16 EUR Subtotal3.304,16 EUR SUBTOTAL TARIFF NO. Tariff No.Subtotal420292989089,10EUR",
   { qty: 291, total: 3304.16 }],
  ["a discount printed after Total is not part of this footer",
   "Goods total2913.304,16 EUR Subtotal3.304,16 EUR VAT0,00 EUR Total3.304,16 EUR Discount100,00 EUR",
   { qty: 291, total: 3304.16 }],
  ["glued goods total with a spaced footer still resolves",
   "Goods total2913.304,16 EUR Discount  366,70 EUR Subtotal  2.937,46 EUR",
   { qty: 291, total: 3304.16 }],
  ["a spaced per-page subtotal must not beat a later glued grand total",
   "Goods total50 1.000,00 EUR ...items... Goods total2913.304,16 EUR Subtotal3.304,16 EUR",
   { qty: 291, total: 3304.16 }],
  ["four-digit amount without separator",
   "Goods total2913304,16 EUR Subtotal3304,16 EUR",
   { qty: 291, total: 3304.16 }],

  // ── Credit notes are detected and refused, not parsed ─────────────────────
  // The per-line reader has no sign handling, so a parsed credit note ships a
  // workbook with every amount positive. Detection must fire on all shapes.
  ["credit note, glued",
   "Goods total29-3.304,16 EUR Subtotal-3.304,16 EUR",
   { qty: null, total: null, creditNote: true }],
  ["credit note, spaced",
   "Goods total29 -3.304,16 EUR Subtotal-3.304,16 EUR",
   { qty: null, total: null, creditNote: true }],
  ["credit note with a discount line",
   "Goods total15-487,34 EUR Discount-87,34 EUR Subtotal-400,00 EUR",
   { qty: null, total: null, creditNote: true }],
  ["credit note without thousands separator",
   "Goods total4-399,98 EUR Subtotal-399,98 EUR",
   { qty: null, total: null, creditNote: true }],

  // ── Hyphens that are not a minus sign ─────────────────────────────────────
  ["hyphenated token is not a quantity",
   "Goods total 12-34 8.429,10 CHF Subtotal8.429,10 CHF",
   { qty: null, total: null }],
  ["dash placeholder must not become NaN",
   "Goods total - 8.429,10 CHF Subtotal 8.429,10 CHF",
   { qty: null, total: null }],

  ["tariff table before the footer falls back to the whole text",
   "SUBTOTAL TARIFF NO. Tariff No.Subtotal 420292989089,10CHF Goods total226 8.429,10 CHF Subtotal8.429,10 CHF",
   { qty: 226, total: 8429.10 }],

  // ── Must refuse rather than guess ─────────────────────────────────────────
  ["no Subtotal to pin the amount",
   "Goods total2913.304,16 EUR VAT0,00 EUR",
   { qty: null, total: null }],
  ["no split reproduces the target",
   "Goods total99999,99 EUR Subtotal12,34 EUR",
   { qty: null, total: null }],
  ["no goods total at all",
   "Subtotal3.304,16 EUR VAT0,00 EUR",
   { qty: null, total: null }],
];

let pass = 0, fail = 0;
for (const [name, input, want] of CASES) {
  const got = readGoodsTotal(input);
  const eq = (a, b) => a === null ? b === null : (b !== null && Math.abs(a - b) < 0.005);
  const ok = got.qty === want.qty && eq(want.total, got.total)
          && (!want.creditNote || got.creditNote === true);
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else {
    fail++;
    console.log(`  FAIL  ${name}`);
    console.log(`        want qty=${want.qty} total=${want.total}`);
    console.log(`        got  qty=${got.qty} total=${got.total}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
