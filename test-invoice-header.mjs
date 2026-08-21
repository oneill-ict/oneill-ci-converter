// Tests the invoice-level fields and the footer totals.
//
// These replace test-goods-total.mjs, which tested a reader that worked on flattened text
// and no longer exists. The layouts below are the ones measured in the corpus, including
// the two that the flat-text version got wrong:
//
//   Order number: a value containing spaces. The old regex was /Order number:\s*([\d,]+)/
//   and stopped at the first space, so an invoice listing five orders reported one.
//
//   Discount: the flattened line reads "Discount62.750,50 EUR" with no space, so the old
//   /Discount\s+.../ found nothing. Fifteen of nineteen real invoice discounts were
//   missing from the workbook, the largest EUR 62,750.50.
//
// Run: node test-invoice-header.mjs

import { readHeader } from "./lib/invoice-header.mjs";
import { readFooter, agreesWithFooter } from "./lib/invoice-footer.mjs";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `   got ${g}, want ${w}`}`);
  ok ? pass++ : fail++;
};

// A line is { page, y, runs: [{x, text}] }. Helper keeps the layouts readable.
const L = (y, ...pairs) => ({
  page: 1, y,
  runs: pairs.map(([x, text]) => ({ x, text })),
});

// The standard layout: two columns of label/value pairs, then the address block, then the
// title, then the table. Positions are the ones measured on CI 1146402.
const standard = () => [
  L(560, [756, "O'Neill Europe B.V."]),
  L(531, [291, "Delivery address"], [453, "Billing address"], [772, "The Netherlands"]),
  L(524, [721, "VAT number: NL006028317B01"]),
  L(521, [291, "Southeast Wetsuit"], [453, "Southeast Wetsuit"]),
  L(515, [697, "Chambre of Commerce No.: 28036121"]),
  L(510, [291, "Morriscastle none"], [453, "Attn. Ed Lawler"]),
  L(499, [291, "Y25 Y6T7 Kilmuckridge"], [453, "Morriscastle none"]),
  L(488, [291, "Ireland"], [453, "Y25 Y6T7 Kilmuckridge, Co Wexford"]),
  L(477, [453, "Ireland"]),
  L(433, [18, "Document No.:"], [108, "1146402"], [343, "Transport:"], [433, "MUPS"]),
  L(418, [18, "Date:"], [108, "27-04-2025"], [343, "Transport no.:"], [433, "1Z38A5286838390643"]),
  L(403, [18, "Order number:"], [108, "3583511"], [343, "Number of boxes:"], [433, "8"]),
  L(388, [18, "Delivery terms:"], [108, "DDP"], [343, "Gross weight:"], [433, "65.400,00 gr"]),
  L(306, [14, "COMMERCIAL INVOICE"]),
  L(285, [16, "Item No."], [69, "Item"], [625, "Quantity"], [775, "Total"]),
];

console.log("\n  de standaard kop");
{
  const h = readHeader(standard());
  eq("datum",            h.date,           "27-04-2025");
  eq("ordernummer",      h.orderNumber,    "3583511");
  eq("leveringsconditie", h.deliveryTerms, "DDP");
  eq("aantal dozen",     h.numberOfBoxes,  "8");
  eq("brutogewicht",     h.grossWeight,    "65.400,00 gr");
  eq("naam",             h.billingName,    "Southeast Wetsuit");
  eq("adres uit de juiste kolom", h.billingAddress,
     ["Attn. Ed Lawler", "Morriscastle none", "Y25 Y6T7 Kilmuckridge, Co Wexford", "Ireland"]);
  eq("geen B2B",         h.isB2B,          false);
}

console.log("\n  het adres komt uit de billing-kolom, niet uit de delivery-kolom");
{
  // The two columns sit at the same height. Flattening interleaved them; reading the
  // column the label stands over does not.
  const h = readHeader(standard());
  eq("geen enkele regel uit de leveringskolom",
     h.billingAddress.some(l => l === "Y25 Y6T7 Kilmuckridge"), false);
  eq("en niets uit het afzenderblok rechts",
     [h.billingName, ...h.billingAddress].some(l => /O'Neill Europe|Chambre|NL006028317B01/.test(l)), false);
}

console.log("\n  een ordernummer met spaties erin");
{
  // Five orders on one invoice. /Order number:\s*([\d,]+)/ returned "3354034,".
  const lines = standard().map(l => l.y !== 403 ? l
    : L(403, [18, "Order number:"], [108, "3354034, 3479625, 3502672, 3567969, 3588254"],
             [343, "Number of boxes:"], [433, "8"]));
  eq("alle vijf", readHeader(lines).orderNumber,
     "3354034, 3479625, 3502672, 3567969, 3588254");
}

console.log("\n  een label zonder waarde levert leeg, niet het volgende label");
{
  const lines = standard().map(l => l.y !== 403 ? l
    : L(403, [18, "Order number:"], [343, "Number of boxes:"], [433, "8"]));
  const h = readHeader(lines);
  eq("ordernummer leeg", h.orderNumber, "");
  eq("en de buur is niet beschadigd", h.numberOfBoxes, "8");
}

console.log("\n  B2B wordt herkend aan de bestemming");
{
  const lines = standard().map(l => l.y !== 510 ? l
    : L(510, [291, "Morriscastle none"], [453, "M+R Spedag Group AG"]));
  eq("Spedag = B2B", readHeader(lines).isB2B, true);
}

console.log("\n  labels onder de titel worden niet meegenomen");
{
  // The legal footer repeats "VAT number:" and the like. The header block is bounded by
  // the COMMERCIAL INVOICE title.
  const lines = [...standard(),
    L(100, [16, "Date:"], [108, "01-01-1999"]),
    L(90,  [16, "Gross weight:"], [108, "999,00 gr"])];
  const h = readHeader(lines);
  eq("datum blijft die van de kop", h.date, "27-04-2025");
  eq("gewicht blijft dat van de kop", h.grossWeight, "65.400,00 gr");
}

console.log("\n  geen kop, geen verzinsels");
{
  const h = readHeader([L(285, [16, "Item No."], [625, "Quantity"])]);
  eq("datum leeg",   h.date, "");
  eq("adres leeg",   h.billingAddress, []);
  eq("naam leeg",    h.billingName, "");
}

// ── The footer ──────────────────────────────────────────────────────────────
const footerLines = (...extra) => [
  L(285, [16, "Item No."], [69, "Item"], [232, "Colour"], [332, "Colour no."],
         [385, "Item group"], [505, "Tariff No."], [565, "Nett weight"],
         [625, "Quantity"], [715, "Discount"], [775, "Total"]),
  ...extra,
];

console.log("\n  de gewone footer");
{
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "291"], [775, "3.304,16 EUR"]),
    L(90,  [16, "Subtotal"],    [775, "3.304,16 EUR"]),
    L(80,  [16, "VAT"],         [775, "0,00 EUR"]),
    L(70,  [16, "Total"],       [775, "3.304,16 EUR"])));
  eq("aantal",      f.qty,        291);
  eq("totaal",      f.total,      3304.16);
  eq("geen korting", f.discount,  0);
  eq("geen btw",    f.vat,        0);
  eq("geen creditnota", f.creditNote, false);
}

console.log("\n  een factuurkorting");
{
  // Fifteen of nineteen of these were missing from the workbook.
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "18625"], [775, "418.336,66 EUR"]),
    L(90,  [16, "Discount"],    [775, "62.750,50 EUR"]),
    L(80,  [16, "Subtotal"],    [775, "355.586,16 EUR"]),
    L(70,  [16, "VAT"],         [775, "0,00 EUR"]),
    L(60,  [16, "Total"],       [775, "355.586,16 EUR"])));
  eq("aantal",  f.qty,      18625);
  eq("totaal",  f.total,    418336.66);
  eq("korting", f.discount, 62750.5);
}

console.log("\n  de kolomkop heet ook Discount en Total, en telt niet mee");
{
  // The header row carries those words too, which is why the reader requires the label to
  // be the leftmost run on a line of at most three runs.
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "4"], [775, "399,98 EUR"])));
  eq("geen korting uit de kolomkop", f.discount, 0);
  eq("aantal gewoon gelezen",       f.qty,      4);
}

console.log("\n  btw");
{
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "75"], [775, "3.190,02 CHF"]),
    L(90,  [16, "Shipping costs"], [775, "155,19 CHF"]),
    L(80,  [16, "Subtotal"],    [775, "3.345,21 CHF"]),
    L(70,  [16, "VAT"],         [775, "270,96 CHF"]),
    L(60,  [16, "Total"],       [775, "3.616,17 CHF"])));
  eq("btw gelezen", f.vat,   270.96);
  eq("aantal",      f.qty,   75);
  eq("totaal",      f.total, 3190.02);
}

console.log("\n  een creditnota wordt geweigerd, niet gelezen");
{
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "2"], [775, "-34,78 EUR"]),
    L(90,  [16, "Total"],       [775, "-34,78 EUR"])));
  eq("gemarkeerd", f.creditNote, true);
  eq("aantal niet doorgegeven",  f.qty,   null);
  eq("totaal niet doorgegeven",  f.total, null);
}

console.log("\n  per-pagina subtotalen schaduwen het eindtotaal niet");
{
  const f = readFooter(footerLines(
    L(200, [16, "Goods total"], [625, "100"], [775, "1.000,00 EUR"]),
    L(100, [16, "Goods total"], [625, "291"], [775, "3.304,16 EUR"])));
  eq("het laatste geldt", f.qty,   291);
  eq("en zijn bedrag",    f.total, 3304.16);
}

console.log("\n  geen footer, geen getallen");
{
  const f = readFooter(footerLines());
  eq("aantal null", f.qty,   null);
  eq("totaal null", f.total, null);
}


console.log("\n  verzendkosten en de reconciliatie van het eindtotaal");
{
  // Two corpus invoices print a Shipping costs line between Goods total and Subtotal. It
  // was not in the model at all, so it fell out of the workbook's end total: EUR 443.38 on
  // one and EUR 155.22 on the other, on a customs document.
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "226"], [775, "8.429,10 CHF"]),
    L(90,  [16, "Shipping costs"], [775, "443,40 CHF"]),
    L(80,  [16, "Subtotal"],    [775, "8.872,50 CHF"]),
    L(70,  [16, "VAT"],         [775, "718,68 CHF"]),
    L(60,  [16, "Total"],       [775, "9.591,18 CHF"])));
  eq("verzendkosten gelezen", f.shipping,   443.4);
  eq("subtotaal gelezen",     f.subtotal,   8872.5);
  eq("eindtotaal gelezen",    f.grandTotal, 9591.18);

  // The invoice's own arithmetic, which holds on all 42 corpus invoices:
  //   Total = Goods total - Discount + Shipping costs + VAT
  const a = agreesWithFooter([{ quantity: 226, total: 8429.10, price: null, discount: 0 }], f);
  eq("eindtotaal gereconcilieerd", a.endTotalOk, true);
  eq("en het is ook echt gecontroleerd", a.endTotalChecked, true);
}

console.log("\n  een gemiste component wordt zichtbaar in plaats van stil");
{
  // The same invoice with the shipping line unread — the state this converter shipped in.
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "226"], [775, "8.429,10 CHF"]),
    L(80,  [16, "Subtotal"],    [775, "8.872,50 CHF"]),
    L(70,  [16, "VAT"],         [775, "718,68 CHF"]),
    L(60,  [16, "Total"],       [775, "9.591,18 CHF"])));
  const a = agreesWithFooter([{ quantity: 226, total: 8429.10, price: null, discount: 0 }], f);
  eq("de goederentotaal-as blijft groen", a.totalOk, true);
  eq("maar het eindtotaal valt om",       a.endTotalOk, false);
  eq("met het verschil erbij (in centen)", a.endGap, 44340);
}

console.log("\n  100% korting: het eindtotaal is nul en dat is geen ontbrekende waarde");
{
  const f = readFooter(footerLines(
    L(100, [16, "Goods total"], [625, "4"], [775, "399,98 EUR"]),
    L(90,  [16, "Discount"],    [775, "399,98 EUR"]),
    L(80,  [16, "Subtotal"],    [775, "0,00 EUR"]),
    L(70,  [16, "VAT"],         [775, "0,00 EUR"]),
    L(60,  [16, "Total"],       [775, "0,00 EUR"])));
  eq("eindtotaal is 0, niet null", f.grandTotal, 0);
  const a = agreesWithFooter([{ quantity: 4, total: 399.98, price: null, discount: 0 }], f);
  eq("en het klopt", a.endTotalOk, true);
  eq("de as is gecontroleerd", a.endTotalChecked, true);
}

console.log(`
${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
