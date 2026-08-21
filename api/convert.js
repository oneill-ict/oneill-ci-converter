import pdfParse from "pdf-parse/lib/pdf-parse.js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { extractLines, readItemRows } from "../lib/invoice-rows.mjs";
import { readFooter, agreesWithFooter, round2 } from "../lib/invoice-footer.mjs";
import { readHeader } from "../lib/invoice-header.mjs";
import { findCity } from "../lib/invoice-address.mjs";

// There used to be `export const config = { api: { bodyParser: { sizeLimit:
// "10mb" } } }` here. That is Next.js API-route syntax and this is a Vite SPA on
// @vercel/node, so it did nothing — the code believed it had a 10 MB budget while
// the real ceiling is Vercel's own request cap. Measured live: a 4 MB body
// reaches the function, 5 MB gets a platform 413 the code never sees.
//
// So the effective limit is roughly a 3.3 MB PDF once base64 inflation is
// counted. The largest real invoice is 2.1 MB, which is less headroom than
// anyone would assume from that deleted line. The guards that actually bind are
// MAX_BASE64_CHARS and MAX_TEXT_CHARS below, both enforced in this file.

// ── PDF parser ─────────────────────────────────────────────────────────────


// parseInt/parseFloat return NaN on anything unparseable. A NaN quantity reached
// ExcelJS, which writes it verbatim as <v>NaN</v> in a numeric cell — not valid
// SpreadsheetML, so
// Excel opens with the "we found a problem with some content" repair dialog, and
// the response was a 200 OK with an unopenable attachment. The quantity-splitting
// fall-throughs that produced those NaNs are gone, but the cells still pass through
// here: a guard at the point of writing outlives whatever fed it.
export const finiteOr0 = (n) => (Number.isFinite(n) ? n : 0);

// What a parsed value becomes in a spreadsheet cell. Two last lines of defence, both for
// values that came out of the PDF: ExcelJS writes a non-finite number verbatim as
// <v>NaN</v>, which is not valid SpreadsheetML and makes Excel offer to repair the file;
// and text starting with = + - @ becomes a formula if the sheet is exported to CSV.
//
// Exported for the same reason as checkPdfInput: its test used to keep a copy.
export const cellValue = (value) =>
  (typeof value === "number" && !Number.isFinite(value)) ? "" : csvSafe(value);

// Whether a request body's `pdf` field can be decoded at all.
//
// Exported so the tests can call the real thing. They used to hold their own copy of this
// rule, which can go green while the shipped guard is broken — the failure mode this
// repository has already been bitten by twice.
//
// Buffer.from accepts anything array-like and then IGNORES the "base64" argument, so
// `{"pdf":{"length":200000000}}` — a 28-byte request — allocated 191 MB and spent 9
// seconds zero-filling it. Scale the number up and it is either the whole CPU budget or an
// out-of-memory kill, from a body small enough that no request-size limit can see it.
//
// Base64 inflates by ~4/3, so MAX_BASE64_CHARS bounds the decoded PDF to ~5 MB — above the
// platform's own request cap, so it can never be the binding limit for a legitimate file,
// but it stops an oversized string reaching the decoder.
export const MAX_BASE64_CHARS = 7_000_000;

export function checkPdfInput(pdf) {
  if (!pdf) return { status: 400, error: "Geen PDF ontvangen" };
  if (typeof pdf !== "string") return { status: 400, error: "Ongeldige PDF-data" };
  if (pdf.length > MAX_BASE64_CHARS) {
    return {
      status: 413,
      error: "Deze PDF is te groot om te verwerken. Splits de factuur of maak hem handmatig op.",
    };
  }
  return { status: 200 };
}

// Filenames come off the user's disk and in practice carry customer names
// ("CI CH B2B", "Test PDF CH met AT klanten"). The logs are for spotting
// patterns across conversions, which needs a stable identifier, not the name.
// Keep the extension and a short digest so the same file is recognisable across
// entries without the name itself sitting in the log.
function logSafeName(name) {
  if (typeof name !== "string" || !name) return null;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  const ext = (name.match(/\.[^.]{1,6}$/) || [""])[0].toLowerCase();
  return `${(h >>> 0).toString(36)}${ext}`;
}

// Text that Excel would read as a formula if the workbook is ever exported to
// CSV and reopened. The .xlsx itself is safe — ExcelJS writes these as string
// cells and Excel does not reinterpret them on open — but the leading character
// survives a Save As → CSV, and reopening that file makes Excel parse it.
// A leading apostrophe forces text and is invisible in the cell.
// Item names, colours and country names all come from the PDF, so this is the
// one place parsed text could turn into something executable.
export const CSV_UNSAFE_START = /^[=+\-@\t\r]/;
export const csvSafe = (v) =>
  (typeof v === "string" && CSV_UNSAFE_START.test(v)) ? "'" + v : v;

function parseInvoice(lines) {
  const invoice = { items: [], _validation: null };

  // ── Invoice-level fields ──────────────────────────────────────────────────
  // From the block above the item table, read as columns. See lib/invoice-header.mjs.
  Object.assign(invoice, readHeader(lines));

  // ── Auto-city: append the destination city to DDP delivery terms ──────────
  // See lib/invoice-address.mjs for why this is not one regex. The rule that
  // matters here: when no city can be established the term stays a plain "DDP".
  const city = findCity(invoice.billingAddress);
  if (city && invoice.deliveryTerms === "DDP") {
    invoice.deliveryTerms = `DDP ${city}`;
  }

  // ── Invoice footer ────────────────────────────────────────────────────────
  const footer = readFooter(lines);
  invoice.creditNote      = footer.creditNote;
  invoice.invoiceDiscount = footer.discount;
  invoice.shippingCosts   = footer.shipping;
  invoice.vat             = footer.vat;
  const expectedQty   = footer.qty;
  const expectedTotal = footer.total;

  // ── Items ─────────────────────────────────────────────────────────────────
  // Read from the PDF's own table geometry. Everything that used to live here —
  // splitting the flattened text on item-number boundaries, hunting the tariff
  // number, taking the first three currency amounts after it, guessing where the
  // quantity ended and the price began, a repair pass over the guesses, and an
  // item-number database to catch the codes the split regex could not — existed
  // only because flattening glued neighbouring cells together. Each field now
  // comes from its own column.
  const { rows, columns, skipped, unplaced, currency, missingColumns } = readItemRows(lines);

  // No fallback to a document-wide currency search any more. That search is what let a
  // header or a terms paragraph naming another currency set the whole export to it, and
  // it needed the flattened text. When the item rows carry no currency at all there are
  // no amounts to label, so the historical default stands.
  invoice.currency = currency || "CHF";

  invoice.items = rows.map(r => ({
    itemNo: r.itemNo, item: r.item, colour: r.colour, colourNo: r.colourNo,
    country: r.country, tariffNo: r.tariffNo,
    // null, not 0: gross weight is a customs-declared field, so an unknown has to
    // stay visible rather than ship as a declared zero.
    grossWeight: r.weight,
    quantity: r.quantity, pricePerPiece: r.price,
    discount: r.discount, total: r.total,
  }));

  // ── Validate against the invoice's own footer ─────────────────────────────
  // One shared rule, in lib/, so the handler and every test harness apply the same
  // one. See agreesWithFooter for why the tolerance is what it is.
  const check = agreesWithFooter(
    invoice.items.map(i => ({
      quantity: i.quantity, total: i.total, price: i.pricePerPiece, discount: i.discount,
    })),
    footer,
  );
  const { quantity: parsedQty, total: parsedTotal, qtyOk, totalOk, endTotalOk } = check;

  // Lines with no per-line gross weight. One template states it only in the
  // header, so an empty cell is a real case, not a parse failure — but it has to
  // be reported rather than filled in.
  const noWeightLines = invoice.items
    .filter(i => i.grossWeight === null || i.grossWeight === undefined)
    .map(i => i.itemNo);

  // Rows that sit in the item table but could not be read as a customs line. This
  // is what the missing-articles warning now reports: the reader knows exactly
  // which visual rows it declined and why. The old version scanned the flattened
  // text for item numbers absent from the output, which could only ever guess.
  const missedRows = skipped.map(s => ({
    itemNo:  s.itemNo || "???",
    reason:  s.reason,
    context: s.text,
  }));

  invoice._validation = {
    valid: totalOk && qtyOk && endTotalOk && !missingColumns,
    noWeightLines,
    // `valid` alone is ambiguous: totalOk/qtyOk default to true when there is
    // nothing to compare against. `checked` says whether a comparison actually
    // happened, per axis, because the two guard different failures — the total
    // catches dropped or duplicated lines, the quantity catches a wrong line.
    qtyChecked:      check.qtyChecked,
    totalChecked:    check.totalChecked,
    endTotalChecked: check.endTotalChecked,
    checked: check.qtyChecked && check.totalChecked,
    parsedQty, parsedTotal, expectedQty, expectedTotal,
    totalOk, qtyOk, endTotalOk,
    // What the workbook's Total will say against what the invoice prints. A mismatch means
    // a component of the summary block was misread — the failure that hid fifteen
    // discounts and two shipping-cost lines behind a green check.
    endTotal: check.endTotal, printedEndTotal: check.printedEndTotal,
    missedRows,
    unparsedItemNos: [...new Map(missedRows.map(r => [r.itemNo, r])).values()],
    // Nothing reports an unreconciled quantity split any more, because nothing
    // splits a quantity: it is read from its own column. So uncertainLines and
    // repairs are gone from the response rather than sent as empty arrays, and the
    // warning they fed is gone from the frontend.
    //
    // Signs that the template moved: runs that fitted no column, and columns the
    // reader could not name. Reported rather than absorbed — absorbing a stray run
    // into its neighbour is what produced a wrong quantity on six invoices while
    // every total still looked right.
    unplacedRuns:   unplaced || 0,
    missingColumns: missingColumns || null,
    columnsFound:   columns.map(c => c.key).filter(Boolean),
  };

  return invoice;
}

// ── Excel builder ──────────────────────────────────────────────────────────

// Exported so the workbook itself can be tested. It was the last layer with no
// assertions at all: 350 lines deciding what a customs document says, verified only by
// my opening one in Excel and looking at it.
export async function buildExcel(invoice) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "O'Neill CI Converter";
  const ws = wb.addWorksheet("Commercial Invoice");

  // No freeze pane — hide gridlines only for clean document look
  ws.views = [{ showGridLines: false }];

  const hFont    = { name: "Arial", size: 10 };
  const boldFont = { name: "Arial", size: 10, bold: true };

  const setCell = (row, colNum, value, style = {}) => {
    const cell = ws.getCell(row, colNum);
    // Same CSV guard as the data rows — the billing name and address lines also
    // come out of the PDF. Formula objects and numbers pass through untouched.
    cell.value = csvSafe(value);
    cell.font = style.font || hFont;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.fill)      cell.fill      = style.fill;
    if (style.border)    cell.border    = style.border;
    if (style.numFmt)    cell.numFmt    = style.numFmt;
  };

  // ── Fills & borders ───────────────────────────────────────────────────
  const headerFill    = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  const rowAltFill    = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F4FA" } };
  const greyFill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  const tariffHdrFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A4A6B" } };

  const thinLine      = { style: "thin",   color: { argb: "FFD8E0EA" } };
  const fullBorder    = { top: thinLine, bottom: thinLine, left: thinLine, right: thinLine };
  const headerBorder  = { bottom: { style: "medium", color: { argb: "FF1F4E79" } } };
  const summaryBorder = { top:    { style: "medium", color: { argb: "FF1F4E79" } } };
  const tableCloseBorder = { bottom: { style: "medium", color: { argb: "FF1F4E79" } } };

  // ── Cell merges for document layout ──────────────────────────────────
  // Shipper side always 4 rows; ship-to is dynamic (B2B=4 lines, B2C=5 lines
  // because B2C has "O'Neill" as a recipient line inside the address).
  const _shipToCount = Math.min((invoice.billingAddress || []).length + 1, 6);
  ws.mergeCells("A1:E1");  ws.mergeCells("F1:K1");
  for (let i = 0; i < 4; i++) ws.mergeCells(`A${2+i}:E${2+i}`);
  for (let i = 0; i < _shipToCount; i++) ws.mergeCells(`F${2+i}:K${2+i}`);
  ws.mergeCells("A6:E6");  ws.mergeCells("A7:E7");
  // Label : value rows — value cells span to col K (order nr can be very long)
  ws.mergeCells("A9:B9");   ws.mergeCells("C9:K9");
  ws.mergeCells("A10:B10"); ws.mergeCells("C10:K10");
  ws.mergeCells("A11:B11"); ws.mergeCells("C11:K11");
  ws.mergeCells("A12:B12"); ws.mergeCells("C12:K12");
  ws.mergeCells("A13:B13"); ws.mergeCells("C13:K13");
  // Title block — full width, centred
  ws.mergeCells("A15:K15");
  ws.mergeCells("A16:K16");

  // ── Helper: nett weight from PDF grossWeight string (grams → KGS) ─────
  function parseGrossWeightKg(gwStr) {
    if (!gwStr) return null;
    const n = parseFloat(gwStr.replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : Math.round(n / 1000);
  }
  const nettWeightKg = parseGrossWeightKg(invoice.grossWeight);
  const nettWeightStr = nettWeightKg != null ? `${nettWeightKg.toLocaleString("nl-NL")} KGS` : "";

  // ── Date → DDMMYY for order number suggestion ─────────────────────────
  // invoice.date may be "03-05-2026" or "2026-05-03"
  let orderSuggestion = "";
  try {
    const parts = (invoice.date || "").split("-");
    if (parts.length === 3) {
      const [a, b, c] = parts;
      const dd = a.length === 4 ? b.padStart(2,"0") : a.padStart(2,"0");
      const mm = a.length === 4 ? c.padStart(2,"0") : b.padStart(2,"0");
      const yy = a.length === 4 ? a.slice(2) : c.slice(2);
      orderSuggestion = `${dd}${mm}${yy}-1`;
    }
  } catch {}

  // ── Header block (logistics format) ──────────────────────────────────
  // Row 1: Shipper / Ship to labels
  setCell(1, 1, "Shipper",  { font: boldFont });
  setCell(1, 6, "Ship to",  { font: boldFont });

  // Rows 2–7: Shipper = O'Neill (fixed, 4 lines) | Ship to = billing address (dynamic)
  const shipperLines = ["O'Neill Europe B.V.", "Oosteinde 32", "2361 HE Warmond", "The Netherlands"];
  const shipToLines  = [invoice.billingName, ...(invoice.billingAddress || [])];
  for (let i = 0; i < 4; i++) setCell(2 + i, 1, shipperLines[i] || "");
  for (let i = 0; i < Math.min(shipToLines.length, 6); i++) {
    if (shipToLines[i]) setCell(2 + i, 6, shipToLines[i]);
  }
  setCell(6, 1, "VAT number: NL006028317B01");
  setCell(7, 1, "Chambre of Commerce No.: 28036121");

  // Row 9: Date
  setCell(9, 1, "Date:", { font: boldFont });
  setCell(9, 3, invoice.date);

  // Row 10: Order / Invoice number
  //
  // The date-derived suggestion wins over the invoice's own order number, and that is
  // deliberate: this is the logistics number the shipment is filed under, not the ERP order
  // reference. An audit flagged it as the invoice missing its own reference, and it was
  // confirmed as intended — keep it as it is.
  //
  // This line has not changed since the first commit, and the positional rewrite did not
  // change what it renders either: its only input is invoice.date, and that reads identically
  // to the old regex on all 45 corpus invoices. test-workbook.mjs pins the behaviour so a
  // well-meant "fix" fails a test instead of quietly changing what a customs document says.
  setCell(10, 1, "Order number / Invoice nr.:", { font: boldFont });
  setCell(10, 3, orderSuggestion || invoice.orderNumber);

  // Row 11: Delivery terms
  setCell(11, 1, "Delivery terms:", { font: boldFont });
  setCell(11, 3, invoice.deliveryTerms || "DDP");

  // Rows 12 and 13: the weights.
  //
  // "Nett weight" is filled from the PDF's "Gross weight:" field, and "Gross weight" is left
  // empty for someone to complete by hand. That reads like a mix-up and an audit flagged it
  // as one — it is not. This is what the O'Neill logistics template asks for: the figure the
  // invoice states is the nett weight for this form, and the gross weight is added later once
  // packaging is known. For customs the distinction is not cosmetic, so it is written down
  // here rather than left to look like a bug, and pinned by a test.
  setCell(12, 1, "Nett weight:", { font: boldFont });
  setCell(12, 3, nettWeightStr);

  setCell(13, 1, "Gross weight:", { font: boldFont });
  setCell(13, 3, "");

  // Row 15: COMMERCIAL INVOICE — full width, centred
  ws.getRow(15).height = 20;
  setCell(15, 1, "COMMERCIAL INVOICE", {
    font:      { name: "Arial", size: 12, bold: true },
    alignment: { horizontal: "center", vertical: "middle" },
  });

  // Row 16: * for custom purposes only * — full width, centred
  setCell(16, 1, "* for custom purposes only *", {
    font:      { name: "Arial", size: 10, italic: true },
    alignment: { horizontal: "center", vertical: "middle" },
  });

  // ── Column headers (row 18) — light blue fill ─────────────────────────

  const cur = invoice.currency || "CHF";
  const headers = [
    "Item No.", "Item", "Colour", "Colour no.", "Country of origin",
    "Tariff No.", "Nett weight", "Quantity", `Price per piece (${cur})`, `Discount (${cur})`, `Total (${cur})`,
  ];

  ws.getRow(18).height = 22;
  headers.forEach((h, i) => {
    setCell(18, i + 1, h, {
      font:      { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } },
      fill:      headerFill,
      border:    headerBorder,
      alignment: { horizontal: i >= 6 ? "right" : "left", vertical: "middle" },
    });
  });

  // ── Data rows (start at 19) ───────────────────────────────────────────

  const DATA_START = 19;

  // The workbook carries the invoice's own line totals, so the number written
  // and the number validated are the same by construction rather than by check.
  invoice.items.forEach(item => { item._total = item.total; });
  const goodsTotalQty    = invoice.items.reduce((s, it) => s + it.quantity, 0);
  const goodsTotalAmount = round2(invoice.items.reduce((s, it) => s + it._total, 0));
  const invoiceDiscount  = invoice.invoiceDiscount || 0;

  const lastDataRow  = DATA_START + invoice.items.length - 1;

  invoice.items.forEach((item, idx) => {
    const r       = DATA_START + idx;
    const altFill = idx % 2 === 1 ? rowAltFill : null;
    // Last data row gets a medium bottom border to close the table
    const isLast  = r === lastDataRow;
    const bdr     = isLast
      ? { ...fullBorder, bottom: tableCloseBorder.bottom }
      : fullBorder;

    const cd = (colNum, value, extra = {}) => {
      const cell = ws.getCell(r, colNum);
      cell.value = cellValue(value);
      cell.font  = hFont;
      if (altFill) cell.fill = altFill;
      cell.border = bdr;
      if (extra.numFmt)    cell.numFmt    = extra.numFmt;
      if (extra.alignment) cell.alignment = extra.alignment;
    };

    // Keep N-prefixed item numbers (e.g. N03204) as string; pure digits as number
    const itemNoVal = /^\d+$/.test(item.itemNo) ? parseInt(item.itemNo, 10) : item.itemNo;
    cd(1,  itemNoVal,          { alignment: { horizontal: "left" } });
    cd(2,  item.item);
    cd(3,  item.colour);
    cd(4,  item.colourNo,      { alignment: { horizontal: "left" } });
    cd(5,  item.country);
    cd(6,  item.tariffNo,      { alignment: { horizontal: "left" } });
    // Empty rather than 0 when the invoice does not state a per-line weight —
    // a zero here would read as a declared weight of nothing.
    cd(7,  item.grossWeight ?? "", { numFmt: "#,##0.00", alignment: { horizontal: "right" } });
    cd(8,  item.quantity,      { numFmt: "#,##0",    alignment: { horizontal: "right" } });
    cd(9,  item.pricePerPiece, { numFmt: "#,##0.00", alignment: { horizontal: "right" } });
    cd(10, item.discount,      { numFmt: "#,##0.00", alignment: { horizontal: "right" } });

    // Total — formula with pre-calculated result so cache is populated
    const tc     = ws.getCell(r, 11);
    // The invoice's own line total, as a value. It used to be the formula
    // H*I-J, which cannot reproduce the printed total whenever the unit price is
    // rounded to two decimals: 3 x 19,22 gives 57,66 where the invoice says
    // 57,65, because the real price is 19,2166... Across 172 lines those cents
    // accumulated and the workbook ended up 12 cents away from the invoice.
    // A customs document has to reproduce the invoice, so quantity, price and
    // total are now all carried exactly as printed. The aggregations below stay
    // formulas — that is where a reader wants to trace a sum.
    tc.value     = item.total;
    tc.numFmt    = "#,##0.00";
    tc.font      = hFont;
    tc.alignment = { horizontal: "right" };
    if (altFill) tc.fill = altFill;
    tc.border    = bdr;

    ws.getRow(r).height = 15.75;
  });

  // ── Summary rows ──────────────────────────────────────────────────────
  //
  // Built as a list rather than as offsets from summaryStart. It used to be
  // `summaryStart + (hasDiscount ? 3 : 2)` and friends — four expressions that all had to
  // be kept in agreement, and adding the Shipping costs line would have made it eight.
  // Duplicated offsets like these have already cost this workbook once: the legal footer's
  // start row was computed a second way and wrote over the tariff check rows.
  //
  // Discount subtracts and Shipping costs adds, which is what the invoice's own arithmetic
  // says on all 42 corpus invoices:
  //   Subtotal = Goods total - Discount + Shipping costs
  //   Total    = Subtotal + VAT

  const summaryStart = lastDataRow + 2;
  const shipping = invoice.shippingCosts || 0;

  const parts = [
    { key: "goods",    label: "Goods total", sign: +1,
      qty:    { formula: `SUM(H${DATA_START}:H${lastDataRow})`, result: goodsTotalQty },
      amount: { formula: `SUM(K${DATA_START}:K${lastDataRow})`, result: goodsTotalAmount },
      border: true, bold: true },
    invoiceDiscount > 0 && { key: "discount", label: "Discount", sign: -1,
      amount: { value: invoiceDiscount }, bold: true },
    shipping > 0 && { key: "shipping", label: "Shipping costs", sign: +1,
      amount: { value: shipping }, bold: true },
  ].filter(Boolean);

  const rowOf = {};
  parts.forEach((p, i) => { rowOf[p.key] = summaryStart + i; });

  for (const p of parts) {
    const r = rowOf[p.key];
    setCell(r, 1, p.label, { font: boldFont, ...(p.border ? { border: summaryBorder } : {}) });
    if (p.qty) {
      const c = ws.getCell(r, 8);
      c.value = p.qty; c.numFmt = "#,##0"; c.font = boldFont;
      c.alignment = { horizontal: "right" };
      if (p.border) c.border = summaryBorder;
    }
    const c = ws.getCell(r, 11);
    c.value = "value" in p.amount ? p.amount.value : p.amount;
    c.numFmt = "#,##0.00"; c.font = boldFont; c.alignment = { horizontal: "right" };
    if (p.border) c.border = summaryBorder;
  }

  const gtRow = rowOf.goods;

  // Subtotal as a formula over whichever component rows exist, so the workbook shows the
  // sum rather than a number this converter asserts.
  const stRow = summaryStart + parts.length;
  const subtotalResult = round2(goodsTotalAmount - invoiceDiscount + shipping);
  const subtotalFormula = parts
    .map(p => `${p.sign < 0 ? "-" : "+"}K${rowOf[p.key]}`)
    .join("")
    .replace(/^\+/, "");
  setCell(stRow, 1, "Subtotal", { font: boldFont });
  const stCell = ws.getCell(stRow, 11);
  stCell.value  = { formula: subtotalFormula, result: subtotalResult };
  stCell.numFmt = "#,##0.00"; stCell.font = boldFont; stCell.alignment = { horizontal: "right" };

  const vatRow = stRow + 1;
  setCell(vatRow, 1, "VAT", { font: boldFont });
  const vatCell = ws.getCell(vatRow, 11);
  vatCell.value  = invoice.vat;
  vatCell.numFmt = "#,##0.00"; vatCell.font = boldFont; vatCell.alignment = { horizontal: "right" };

  const totRow = vatRow + 1;
  setCell(totRow, 1, "Total", { font: { name: "Arial", size: 11, bold: true } });
  const totCell2    = ws.getCell(totRow, 11);
  totCell2.value    = { formula: `K${stRow}+K${vatRow}`, result: round2(subtotalResult + invoice.vat) };
  totCell2.numFmt   = "#,##0.00";
  totCell2.font     = { name: "Arial", size: 11, bold: true };
  totCell2.alignment = { horizontal: "right" };

  // ── Tariff subtotals ──────────────────────────────────────────────────

  const lastRow = lastDataRow;
  const tariffSectionStart = totRow + 3;

  setCell(tariffSectionStart, 1, "SUBTOTAL TARIFF NO.", { font: boldFont });

  // Four columns, not one. The tariff subtotals decide the duty, and until now a reader
  // could only see a code and an amount: checking whether the grouping was right meant
  // filtering the item rows by hand and adding them up. Nothing in the converter
  // validates the tariff column either — it is read from its own column and trusted,
  // because the invoice footer only states a quantity and a total, not a breakdown.
  //
  // So the workbook now shows enough to check it at a glance: how many lines and how
  // many pieces fall under each code, and a difference row that has to read zero. All
  // of it as live Excel formulas, so a reader can follow any figure back to the rows it
  // came from rather than taking a number this converter printed on faith.
  //
  // The amount stays in column B where it has always been, so anything downstream that
  // reads this block by position keeps working.
  const tariffHeaders = [
    [1, "Tariff No.",           "left"],
    [2, `Subtotal (${cur})`,    "right"],
    [3, "Lines",                "right"],
    [4, "Pieces",               "right"],
  ];
  for (const [col, label, align] of tariffHeaders) {
    setCell(tariffSectionStart + 1, col, label, {
      font: { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } },
      fill: tariffHdrFill, border: headerBorder, alignment: { horizontal: align },
    });
  }

  const seen = new Set();
  const uniqueTariffs = [];
  for (const item of invoice.items) {
    if (!seen.has(item.tariffNo)) { seen.add(item.tariffNo); uniqueTariffs.push(item.tariffNo); }
  }

  // Cached results, so the workbook is right on open without Excel recalculating.
  const tariffTotals = {};
  const tariffLines  = {};
  const tariffPieces = {};
  for (const item of invoice.items) {
    tariffTotals[item.tariffNo] = round2((tariffTotals[item.tariffNo] || 0) + item._total);
    tariffLines[item.tariffNo]  = (tariffLines[item.tariffNo]  || 0) + 1;
    tariffPieces[item.tariffNo] = (tariffPieces[item.tariffNo] || 0) + item.quantity;
  }

  const tariffCol = `$F$${DATA_START}:$F$${lastRow}`;
  const totalCol  = `$K$${DATA_START}:$K$${lastRow}`;
  const qtyCol    = `$H$${DATA_START}:$H$${lastRow}`;

  uniqueTariffs.forEach((tariff, i) => {
    const r    = tariffSectionStart + 2 + i;
    const fill = i % 2 === 1 ? greyFill : null;
    setCell(r, 1, tariff, { font: boldFont, ...(fill ? { fill } : {}) });

    // SUMPRODUCT rather than SUMIF/COUNTIF throughout: both the range and the criteria
    // cell hold the tariff number as text, and SUMIF coerces a numeric-looking criteria
    // to a number — the classic number-vs-text-in-range silent zero. The workbook opens
    // correctly either way because the result is cached, so this only showed up once a
    // user edited a cell and Excel recalculated.
    const match = `--(${tariffCol}=A${r})`;
    const cells = [
      [2, `SUMPRODUCT(${match},${totalCol})`, tariffTotals[tariff] || 0, "#,##0.00"],
      [3, `SUMPRODUCT(${match})`,             tariffLines[tariff]  || 0, "0"],
      [4, `SUMPRODUCT(${match},${qtyCol})`,   tariffPieces[tariff] || 0, "0"],
    ];
    for (const [col, formula, result, numFmt] of cells) {
      const c = ws.getCell(r, col);
      c.value     = { formula, result };
      c.numFmt    = numFmt;
      c.font      = boldFont;
      if (fill) c.fill = fill;
      c.alignment = { horizontal: "right" };
    }
  });

  // ── Does the breakdown account for the whole invoice? ──────────────────────
  // Three rows: what the codes add up to, what the invoice says, and the difference.
  // A non-zero difference means a line is counted twice or not at all — which is
  // exactly the failure a misread tariff column would cause, and the only place in
  // this workbook where it becomes visible.
  const firstT = tariffSectionStart + 2;
  const lastT  = tariffSectionStart + 1 + uniqueTariffs.length;
  // gtRow, not lastRow + 2. Those are the same row and stay the same row — a discount
  // shifts the rows below Goods total, not Goods total itself, so this is not a latent
  // bug. It is a second copy of where that row lives, which is worth removing before it
  // becomes one: the row has a name, so use the name.
  const goodsRow = gtRow;
  const checkRows = [
    ["Tariff total", (col) => `SUM(${col}${firstT}:${col}${lastT})`],
    ["Invoice total", (col) => col === "B" ? `K${goodsRow}`
                            : col === "C" ? `SUMPRODUCT(--(${tariffCol}<>""))`
                            : `H${goodsRow}`],
    ["Difference",   (col) => `${col}${lastT + 1}-${col}${lastT + 2}`],
  ];
  const totalsByCol = {
    B: round2(Object.values(tariffTotals).reduce((s, n) => s + n, 0)),
    C: invoice.items.length,
    D: invoice.items.reduce((s, i) => s + i.quantity, 0),
  };
  const lastCheckRow = lastT + checkRows.length;
  checkRows.forEach(([label, formulaFor], n) => {
    const r    = lastT + 1 + n;
    const bold = { name: "Arial", size: 10, bold: n === 2 };
    setCell(r, 1, label, { font: bold });
    for (const col of ["B", "C", "D"]) {
      const c = ws.getCell(`${col}${r}`);
      // Row 0 and row 1 are the same figure by construction, so the difference caches
      // as 0. It is a formula, not a printed zero: the moment a cell is edited or a row
      // deleted, Excel recomputes it and the zero stops being true.
      c.value     = { formula: formulaFor(col), result: n === 2 ? 0 : totalsByCol[col] };
      c.numFmt    = col === "B" ? "#,##0.00" : "0";
      c.font      = bold;
      c.alignment = { horizontal: "right" };
    }
  });

  // ── Legal / customs footer ────────────────────────────────────────────────
  // Swiss-specific footer (Turkish origin + ZAZ + VAT/UID + optional B2B agent)
  // only applies to CHF invoices destined for Switzerland.
  // Derived from the last row the tariff block actually wrote, not recomputed from the
  // tariff count. It used to be tariffSectionStart + uniqueTariffs.length + 3, which was
  // right until the block grew three check rows — and then the footer wrote straight over
  // the "Invoice total" and "Difference" rows. Only on invoices with enough tariff codes
  // to reach that far, so 40 of 42 looked fine and the two largest silently lost exactly
  // the rows that were supposed to prove the workbook adds up.
  const footerStart = lastCheckRow + 2;
  const isSwiss = (invoice.currency || "CHF") === "CHF";

  if (isSwiss) {
    // Merge footer text rows full-width so long text wraps correctly
    ws.mergeCells(`A${footerStart}:K${footerStart}`);
    ws.mergeCells(`A${footerStart + 1}:K${footerStart + 1}`);
    ws.mergeCells(`A${footerStart + 3}:K${footerStart + 3}`);
    ws.mergeCells(`A${footerStart + 5}:K${footerStart + 5}`);
    ws.mergeCells(`A${footerStart + 6}:K${footerStart + 6}`);

    setCell(footerStart, 1, "Bei Waren türkischen Ursprungs:", { font: boldFont });
    setCell(footerStart + 1, 1,
      "Der Ausführer der Waren, auf die sich diese Handelspapiere beziehen, erklärt, dass diese Waren, soweit nicht anders angegeben, präferenzbegünstigte Türkische Ursprungswaren sind.",
      { font: hFont, alignment: { wrapText: true, vertical: "top" } }
    );
    ws.getRow(footerStart + 1).height = 36;

    setCell(footerStart + 3, 1, "ZAZ account.no 10085-4",       { font: boldFont });
    setCell(footerStart + 5, 1, "VAT No:CHE-133.248.441MWST");
    setCell(footerStart + 6, 1, "UID no:CHE-133.248.441MWST");

    if (invoice.isB2B) {
      for (let i = 8; i <= 12; i++) ws.mergeCells(`A${footerStart + i}:K${footerStart + i}`);
      setCell(footerStart + 8,  1, "Custom clearance agent:", { font: boldFont });
      setCell(footerStart + 9,  1, "M+R Spedag Group AG");
      setCell(footerStart + 10, 1, "Hirsrütiweg");
      setCell(footerStart + 11, 1, "CH-4303 Kaiseraugst");
      setCell(footerStart + 12, 1, "Switzerland");
    }
  }

  // ── Column widths ─────────────────────────────────────────────────────
  // Fixed widths tuned to content: Item col wide enough for longest names (~47 chars)
  [12, 44, 26, 12, 18, 14, 14, 10, 22, 15, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // ── Print setup: A4 landscape, fit to 1 page wide ─────────────────────
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage   = true;
  ws.pageSetup.fitToWidth  = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.pageSetup.paperSize   = 9;

  const buffer = await wb.xlsx.writeBuffer();

  // ExcelJS always writes a VML content-type declaration even when there are no VML files.
  // Excel detects the mismatch and shows a "found a problem" repair dialog.
  // Fix: strip the orphaned VML declaration from [Content_Types].xml.
  const zip = await JSZip.loadAsync(buffer);
  const ctXml = await zip.files["[Content_Types].xml"].async("string");
  const ctFixed = ctXml.replace(/<Default Extension="vml"[^>]*>/g, "");
  zip.file("[Content_Types].xml", ctFixed);
  const cleanBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return cleanBuffer;
}

// ── Handler ────────────────────────────────────────────────────────────────

// Header values must be Latin-1 (Node throws ERR_INVALID_CHAR otherwise) and
// the edge caps total response headers at roughly 16 KB. A conversion that
// succeeded must not die on the way out because a diagnostic header grew too
// large, so an unsafe value is dropped rather than sent.
const MAX_HEADER_BYTES = 4000;
function setSafeHeader(res, name, value) {
  const s = String(value);
  if (Buffer.byteLength(s, "utf8") > MAX_HEADER_BYTES) return false;
  if (/[^\t\x20-\x7e\x80-\xff]/.test(s)) return false;
  res.setHeader(name, s);
  return true;
}

// Outer guard: every uncaught throw below became a bare FUNCTION_INVOCATION_FAILED
// with no JSON body, which the frontend could only show as "HTTP 500".
export default async function handler(req, res) {
  try {
    return await handleConvert(req, res);
  } catch (e) {
    console.error(JSON.stringify({
      event: "ci_unhandled_error",
      message: e?.message || String(e),
      stack: (e?.stack || "").split("\n").slice(0, 4).join(" | "),
    }));
    if (res.headersSent) return res.end();
    // Clear any length staged for the xlsx body we are no longer sending.
    try { res.removeHeader("Content-Length"); } catch {}
    return res.status(500).json({
      error: `Onverwachte fout bij het verwerken: ${e?.message || "onbekende fout"}`,
    });
  }
}

// The app is served from the same origin as this function, so it needs no CORS
// header at all. `*` was granting cross-origin access nothing here uses.
// It was never the vulnerability people assume — there are no cookies, so a
// browser request was never more powerful than curl — but narrowing it costs
// nothing and keeps the surface honest. A same-origin request carries no Origin
// header for simple POSTs, so anything that does send one is not the app.
const ALLOWED_ORIGINS = [
  "https://oneill-ci-converter-lemon.vercel.app",
  "http://localhost:5173",
];

async function handleConvert(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // Without this a cross-origin caller sees only the three safelisted response headers,
    // so every X-Validation-* value is invisible and the client reads the result as
    // unchecked. localhost:5173 is on the allowlist precisely so the dev server can talk to
    // the deployed function — and in that mode every conversion looked unvalidated.
    res.setHeader("Access-Control-Expose-Headers", [
      "Content-Disposition", "X-Validation-Qty", "X-Validation-Total",
      "X-Validation-Expected-Qty", "X-Validation-Expected-Total",
      "X-Validation-Checked", "X-Validation-Qty-Checked", "X-Validation-Total-Checked",
      "X-Line-Count", "X-Currency", "X-Unparsed-Count", "X-Unparsed-Items",
      "X-NoWeight-Count", "X-NoWeight-Items", "X-Preview", "X-Preview-Dropped",
    ].join(", "));
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pdf, filename, force } = req.body || {};
  const input = checkPdfInput(pdf);
  if (input.status !== 200) return res.status(input.status).json({ error: input.error });

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdf, "base64");
  } catch {
    return res.status(400).json({ error: "Ongeldige base64-data" });
  }

  let lines;
  try {
    // One pass now. pdf-parse's own flattened text is not used anywhere any more —
    // every field comes from positions, including the invoice-level block and the
    // footer, so the second parse this used to need is gone.
    //
    // The page cap lives in extractLines: pdf-parse defaults to every page, and a
    // compressed content stream expands enormously, so an unbounded page count is a
    // way to spend the whole budget. The largest real invoice is 30 pages.
    lines = await extractLines(pdfBuffer, pdfParse);
  } catch (e) {
    return res.status(422).json({ error: `PDF kon niet worden gelezen: ${e.message}` });
  }

  // Size cap, measured on what the parser actually consumes rather than on a text
  // rendering nothing reads. The largest real invoice is 55 KB of text; nothing
  // legitimate comes near this.
  const MAX_TEXT_CHARS = 2_000_000;
  const textChars = lines.reduce(
    (sum, l) => sum + l.runs.reduce((n, r) => n + r.text.length, 0), 0);
  if (textChars > MAX_TEXT_CHARS) {
    console.log(JSON.stringify({ event: "ci_text_too_large", chars: textChars }));
    return res.status(422).json({
      error: "Deze PDF bevat ongewoon veel tekst en is niet als factuur te verwerken.",
    });
  }

  const invoice = parseInvoice(lines);

  if (invoice.items.length === 0) {
    console.log(JSON.stringify({ event: "ci_no_items", file: logSafeName(filename), currency: invoice.currency }));
    return res.status(422).json({
      error: "Geen factuurregels gevonden. Controleer of dit een O'Neill Commercial Invoice is.",
    });
  }

  // Credit notes are refused outright, before the mismatch path — that one has a
  // force bypass, and forcing a credit note ships a workbook with every amount
  // sign-flipped. Deliberately not forceable: the numbers are wrong, not merely
  // unverified. No parsedQty in the body, so the client shows a plain error.
  if (invoice.creditNote) {
    console.log(JSON.stringify({ event: "ci_credit_note", file: logSafeName(filename) }));
    return res.status(422).json({
      error: "Dit lijkt een creditnota (negatieve bedragen). Die worden nog niet ondersteund — de bedragen zouden zonder minteken in het Excel komen. Maak deze handmatig op.",
    });
  }

  const v = invoice._validation;

  // Structured log for every conversion — visible in Vercel function logs.
  // Fires regardless of outcome so we can spot patterns without waiting for user reports.
  console.log(JSON.stringify({
    event:          "ci_conversion",
    file:           logSafeName(filename),
    currency:       invoice.currency,
    itemsFound:     invoice.items.length,
    parsedQty:      v?.parsedQty    ?? null,
    parsedTotal:    v?.parsedTotal  ?? null,
    expectedQty:    v?.expectedQty  ?? null,
    expectedTotal:  v?.expectedTotal ?? null,
    valid:          v?.valid         ?? null,
    missedCount:    (v?.missedRows || []).length,
    missed:         (v?.missedRows || []).map(r => ({ itemNo: r.itemNo, reason: r.reason })).slice(0, 10),
    unparsedCount:  (v?.unparsedItemNos || []).length,
    unparsed:       (v?.unparsedItemNos || []).map(r => r.itemNo),
  }));

  // Validation mismatch: return structured error so frontend can show a readable message.
  // When force=true the client explicitly wants the Excel anyway (e.g. after warning).
  if (v && !v.valid && !force) {
    return res.status(422).json({
      error:            "Validatie mislukt na herstel",
      parsedQty:        v.parsedQty,
      expectedQty:      v.expectedQty,
      parsedTotal:      v.parsedTotal,
      expectedTotal:    v.expectedTotal,
      missedRows:       v.missedRows,
      // Bare item numbers, the same shape the X-Unparsed-Items header sends on
      // the success path. It used to send {itemNo, context} objects here, so a
      // component that worked on one path rendered "[object Object]" on the other.
      unparsedItemNos:  (v.unparsedItemNos || []).map(r => r.itemNo),
      noWeightLines:    v.noWeightLines,
      // Which axis actually failed. Without these the client could only guess,
      // and it guessed "quantity" — the heading said the piece count did not
      // match on an invoice whose piece count matched exactly.
      qtyOk:            v.qtyOk,
      totalOk:          v.totalOk,
      endTotalOk:       v.endTotalOk,
      endTotal:         v.endTotal,
      printedEndTotal:  v.printedEndTotal,
    });
  }

  let xlsxBuffer;
  try {
    xlsxBuffer = await buildExcel(invoice);
  } catch (e) {
    return res.status(500).json({ error: `Excel kon niet worden aangemaakt: ${e.message}` });
  }

  // Use the original PDF filename (without extension) if provided, else fall back to order/date
  let exportName;
  if (typeof filename === "string" && filename) {
    exportName = filename.replace(/\.[^.]+$/, ""); // strip extension
  } else {
    // One invoice can carry many order numbers — 86 on the largest in the corpus — so
    // the whole list makes an unusable filename. The first number plus how many follow
    // it identifies the file and stays short: CI_3354034+4.
    const orders = (invoice.orderNumber || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    const orderSlug = orders.length === 0 ? (invoice.date.replace(/[^0-9-]/g, "") || "invoice")
                    : orders.length === 1 ? orders[0]
                    : `${orders[0]}+${orders.length - 1}`;
    exportName = `CI_${orderSlug}`;
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  // Node rejects header values above U+00FF with ERR_INVALID_CHAR, and the
  // filename comes straight from the user's disk — "O'Neill CI.pdf" with a
  // curly apostrophe (U+2019, which Word and Outlook insert automatically)
  // used to crash the response after the Excel had already been built.
  // RFC 6266: a plain-ASCII filename for old clients plus filename* for the rest.
  const asciiName = exportName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "'");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}.xlsx"; filename*=UTF-8''${encodeURIComponent(exportName + ".xlsx")}`
  );
  // Content-Length is set just before res.end, not here: a throw in the ~35
  // lines of header work below would otherwise leave a stale length pointing at
  // the xlsx size on the catch handler's JSON error, and the client would wait
  // for a body that never arrives.
  // Expose validation stats so the frontend can show a summary
  res.setHeader("X-Validation-Qty",   String(invoice._validation?.parsedQty   ?? ""));
  res.setHeader("X-Validation-Total", String(invoice._validation?.parsedTotal ?? ""));
  // Whether the totals were actually compared against the invoice footer.
  // Without this the UI cannot tell a verified result from an unverified one.
  res.setHeader("X-Validation-Checked",        v?.checked ? "1" : "0");
  // Which axes actually ran, so the UI can say "total verified, quantity not"
  // instead of collapsing a half-check into a full pass.
  res.setHeader("X-Validation-Qty-Checked",    v?.qtyChecked   ? "1" : "0");
  res.setHeader("X-Validation-Total-Checked",  v?.totalChecked ? "1" : "0");
  // Number of invoice LINES, as distinct from the piece count above. The UI used
  // the piece count to label rows, producing "+213 more rows" on a 40-line invoice.
  res.setHeader("X-Line-Count",                String(invoice.items.length));
  res.setHeader("X-Validation-Expected-Qty",   String(v?.expectedQty   ?? ""));
  res.setHeader("X-Validation-Expected-Total", String(v?.expectedTotal ?? ""));
  // Expose unparsed item numbers even on success so the frontend can show a soft
  // warning. The list is unbounded in principle — a large invoice hitting a new
  // item format could produce thousands — so send a count alongside a capped list.
  const unparsedNos = (v?.unparsedItemNos || []).map(r => r.itemNo);
  if (unparsedNos.length > 0) {
    res.setHeader("X-Unparsed-Count", String(unparsedNos.length));
    setSafeHeader(res, "X-Unparsed-Items", JSON.stringify(unparsedNos.slice(0, 40)));
  }
  const noWeight = v?.noWeightLines || [];
  if (noWeight.length > 0) {
    res.setHeader("X-NoWeight-Count", String(noWeight.length));
    setSafeHeader(res, "X-NoWeight-Items", JSON.stringify(noWeight.slice(0, 40)));
  }
  // First-10-rows preview so the frontend can show a table before confirming download
  const previewRows = invoice.items.slice(0, 10).map(it => ({
    n: it.itemNo,
    i: it.item.slice(0, 28),
    c: it.colour.slice(0, 18),
    q: it.quantity,
    p: it.pricePerPiece,
    t: it.total,
  }));
  // Percent-encoding roughly triples accented text, so a full 10-row preview can
  // approach the header cap. Shrink it rather than let it be dropped silently —
  // the preview is the user's only sanity check before the file leaves.
  let previewSent = setSafeHeader(res, "X-Preview", encodeURIComponent(JSON.stringify(previewRows)));
  for (let n = 5; !previewSent && n >= 1; n = Math.floor(n / 2)) {
    previewSent = setSafeHeader(res, "X-Preview", encodeURIComponent(JSON.stringify(previewRows.slice(0, n))));
  }
  if (!previewSent) res.setHeader("X-Preview-Dropped", "1");
  res.setHeader("Content-Length", xlsxBuffer.byteLength);
  // xlsxBuffer is already a Node Buffer; wrapping it again copied the whole file.
  return res.status(200).end(xlsxBuffer);
}
