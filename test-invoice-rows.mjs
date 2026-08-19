// Unit tests for lib/invoice-rows.mjs.
//
// The property under test is refusal: a cell the parser does not fully understand
// must come back null, not a plausible number. An earlier draft accepted
// "380,00 gr" as 380 in the quantity column and produced a wrong quantity on six
// invoices while every total still looked right — the exact silent-wrongness this
// module exists to prevent.

import { parseAmount, parseWeight, buildGrid, readItemRows } from "./lib/invoice-rows.mjs";

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


// ── Discount conventions ────────────────────────────────────────────────────
// An invoice states its discount either for the whole line or per piece, and only a
// row with a real discount on more than one piece can tell the two apart. Getting
// this wrong is not loud: the first version of the reader tested only the per-line
// form, so on the one per-piece template in the corpus the price column failed its
// check and shipped 29 empty cells while the quantity and total still matched the
// invoice footer.

// The column positions and header labels of the real template. Two columns carry no
// header on any template, which is why the reader has to infer them.
const X = { itemNo: 16, item: 69, colour: 232, colourNo: 332, itemGroup: 385,
            country: 445, tariffNo: 505, weight: 565, quantity: 625, price: 670,
            discount: 715, total: 775 };
const HEADER = ["Item No.", "Item", "Colour", "Colour no.", "Item group", null,
                "Tariff No.", "Nett weight", "Quantity", null, "Discount", "Total"];
const KEYS = Object.keys(X);
const money = (n) => n.toFixed(2).replace(".", ",") + " EUR";

function sheet(rows) {
  const lines = [{
    page: 1, y: 700,
    runs: KEYS.map((k, i) => HEADER[i] && { x: X[k], text: HEADER[i] }).filter(Boolean),
  }];
  rows.forEach(([qty, price, disc, total], n) => {
    const cells = {
      itemNo: "1150059", item: "O'NEILL COASTAL TOTE", colour: "Peach Island Sky",
      colourNo: "32546", itemGroup: "Bags", country: "China", tariffNo: "4202929890",
      weight: "380,00 gr", quantity: String(qty), price: money(price),
      discount: money(disc), total: money(total),
    };
    lines.push({ page: 1, y: 680 - n * 13, runs: KEYS.map(k => ({ x: X[k], text: cells[k] })) });
  });
  return lines;
}

console.log("kortingen per regel");
{
  const { rows, discountPerPiece, columns } = readItemRows(sheet([
    [3, 20, 12, 48], [2, 10, 5, 15], [5, 4, 0, 20], [1, 9, 1, 8],
  ]));
  eq("vier regels gelezen", rows.length, 4);
  eq("prijskolom benoemd", columns.filter(c => c.key === "price").length, 1);
  eq("niet per stuk", discountPerPiece, false);
  eq("regelkorting overgenomen", rows[0].discount, 12);
  eq("prijs gelezen", rows[0].price, 20);
}

console.log("kortingen per stuk");
{
  // The real shape from CI Bens Surf Clinic: 3 x (17,39 - 6,09) = 33,90.
  const { rows, discountPerPiece, columns } = readItemRows(sheet([
    [3, 17.39, 6.09, 33.90], [19, 13.04, 4.56, 161.12], [2, 15.21, 6.84, 16.74], [1, 19.56, 6.85, 12.71],
  ]));
  eq("vier regels gelezen", rows.length, 4);
  eq("prijskolom benoemd", columns.filter(c => c.key === "price").length, 1);
  eq("per stuk herkend", discountPerPiece, true);
  eq("prijs gelezen", rows[0].price, 17.39);
  // 6,09 per piece x 3 = 18,27 for the line, so the workbook reconciles.
  eq("korting genormaliseerd naar de regel", rows[0].discount, 18.27);
  eq("regel reproduceert het totaal",
     Math.round((rows[0].quantity * rows[0].price - rows[0].discount) * 100) / 100, 33.90);
  eq("ook op de grote regel", rows[1].discount, 86.64);
}

console.log("geen kortingen: blijft per regel");
{
  const { discountPerPiece } = readItemRows(sheet([[3, 20, 0, 60], [2, 10, 0, 20], [5, 4, 0, 20]]));
  eq("standaard per regel", discountPerPiece, false);
}

console.log("regels van 1 stuk kunnen niets onderscheiden");
{
  const { discountPerPiece, rows } = readItemRows(sheet([[1, 20, 5, 15], [1, 10, 2, 8], [1, 4, 1, 3]]));
  eq("blijft per regel", discountPerPiece, false);
  eq("korting ongewijzigd", rows[0].discount, 5);
}

console.log("een prijskolom die geen van beide vormen reproduceert blijft naamloos");
{
  const { rows, columns } = readItemRows(sheet([
    [3, 99, 0, 48], [2, 99, 0, 15], [5, 99, 0, 20], [4, 99, 0, 11],
  ]));
  eq("prijskolom niet benoemd", columns.filter(c => c.key === "price").length, 0);
  eq("prijs leeg gelaten in plaats van geraden", rows[0].price, null);
  eq("aantal en totaal nog wel gelezen", `${rows[0].quantity}/${rows[0].total}`, "3/48");
}

console.log(`
${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
