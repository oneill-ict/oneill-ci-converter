import pdfParse from "pdf-parse/lib/pdf-parse.js";
import ExcelJS from "exceljs";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// ── PDF parser ─────────────────────────────────────────────────────────────

function parseEuropeanNumber(s) {
  if (!s) return 0;
  // "1.234,56" → 1234.56
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}

function splitItemColour(combined) {
  // Item name is ALL CAPS + digits/punctuation; colour starts with TitleCase.
  // Split at first position where UPPERCASE/digit/punct transitions to TitleCase word.
  const idx = combined.search(/(?<=[A-Z0-9\-'"&\s])(?=[A-Z][a-z])/);
  if (idx > 0) return { item: combined.slice(0, idx).trim(), colour: combined.slice(idx).trim() };
  return { item: combined.trim(), colour: "" };
}

const round2 = (n) => Math.round(n * 100) / 100;

function parseQtyPrice(combined, totalCHF, discountCHF = 0) {
  // combined = qty+price, possibly with spaces ("3 30,39") or thousands-sep periods ("11.200,00")
  const s        = combined.trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0 };
  const intPart      = s.slice(0, commaIdx);
  const decPart      = s.slice(commaIdx + 1).trim();
  const expectedProd = round2(totalCHF + discountCHF);

  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceIntRaw = intPart.slice(qLen);
    // Strip thousands-separator periods and leading spaces
    const priceInt = priceIntRaw.replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price)) continue;
    if (Math.abs(round2(qty * price) - expectedProd) < 0.02) return { qty, price };
  }
  return { qty: parseInt(intPart, 10), price: parseFloat(`0.${decPart}`) };
}

function bestQtyPrice(combined, totalCHF, discountCHF = 0) {
  const s        = combined.trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0 };
  const intPart  = s.slice(0, commaIdx);
  const decPart  = s.slice(commaIdx + 1).trim();
  const target   = round2(totalCHF + discountCHF);
  let bestDiff   = Infinity;
  let best       = null;
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceIntRaw = intPart.slice(qLen);
    const priceInt    = priceIntRaw.replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price)) continue;
    const diff  = Math.abs(round2(qty * price) - target);
    if (diff < bestDiff) { bestDiff = diff; best = { qty, price }; }
  }
  return best || { qty: parseInt(intPart, 10), price: parseFloat(`0.${decPart}`) };
}

function extractCountry(groupCountry) {
  // e.g. "BlousesIndia" or "Dresses & JumpsuitsBangladesh" or "FootwearChina"
  // Country starts where a lowercase letter is followed by an uppercase letter
  const idx = groupCountry.search(/(?<=[a-z])(?=[A-Z])/);
  if (idx > 0) return groupCountry.slice(idx).trim();
  return groupCountry.trim();
}

function parseInvoiceText(text) {
  const invoice = {
    date: "", orderNumber: "", deliveryTerms: "", numberOfBoxes: "",
    grossWeight: "", billingName: "", billingAddress: [],
    items: [], invoiceDiscount: 0, vat: 0,
    _validation: null,
  };

  // ── Header fields ─────────────────────────────────────────────────────────
  const dateM     = /Date:\s*([\d\-]+)/.exec(text);
  const orderM    = /Order number:\s*([\d,]+)/i.exec(text);
  const deliveryM = /Delivery terms:\s*(\S+)/.exec(text);
  const boxesM    = /Number of boxes:\s*(\d+)/.exec(text);
  const weightM   = /Gross weight:\s*([\d.,]+ gr)/.exec(text);
  if (dateM)     invoice.date          = dateM[1].trim();
  if (orderM)    invoice.orderNumber   = orderM[1].trim();
  if (deliveryM) invoice.deliveryTerms = deliveryM[1].trim();
  if (boxesM)    invoice.numberOfBoxes = boxesM[1].trim();
  if (weightM)   invoice.grossWeight   = weightM[1].trim();

  const billingBlock = /Billing address\s+([\s\S]+?)O'Neill/i.exec(text);
  if (billingBlock) {
    const addrLines = billingBlock[1].trim().split(/\n/).map(l => l.trim()).filter(Boolean);
    invoice.billingName    = addrLines[0] || "";
    invoice.billingAddress = addrLines.slice(1);
  }

  // ── Normalise text ────────────────────────────────────────────────────────
  // Collapse newlines to spaces so multi-line PDF cells don't break the regex.
  // Restrict to the items section to prevent false matches in the header block.
  const flatText   = text.replace(/\n/g, " ");
  const itemsStart = flatText.indexOf("DiscountTotal");

  // The PDF may contain intermediate "Goods total" subtotals per page/category.
  // Use the LAST occurrence so we capture all items across all pages.
  const flatLower  = flatText.toLowerCase();
  const itemsEnd   = flatLower.lastIndexOf("goods total");
  const itemsText  = itemsStart >= 0 && itemsEnd > itemsStart
    ? flatText.slice(itemsStart, itemsEnd)
    : flatText;

  // Expected totals — read from the LAST "Goods total N CHF" line (the grand total)
  let lastGtM = null;
  for (const m of flatText.matchAll(/Goods total\s*(\d+)\s+([\d.,]+)\s*CHF/gi)) {
    lastGtM = m;
  }
  const expectedQty   = lastGtM ? parseInt(lastGtM[1], 10) : null;
  const expectedTotal = lastGtM ? parseEuropeanNumber(lastGtM[2]) : null;

  // ── STEP 1 — Split text into per-item blocks ─────────────────────────────
  // Split on standalone 7-digit numbers or N+5-digit numbers only.
  // Single-letter colour suffixes (W34041, B36116, F35235) are NOT item numbers
  // and will never trigger a split here.
  const splitRe = /(?<!\d)(?=(?:\d{7}|N\d{5})(?!\d))/g;
  const blocks  = itemsText.split(splitRe).filter(b => b.trim());

  // ── STEP 2 — Parse each block independently ───────────────────────────────
  const missedRows = [];
  for (const block of blocks) {
    // Item number must appear (near the start of the block)
    const itemNoM = /(\d{7}|N\d{5})(?!\d)/.exec(block);
    if (!itemNoM) {
      // Log blocks that have no item number so we can diagnose gaps
      missedRows.push({ itemNo: "???", reason: "no item number in block", context: block.slice(0, 150).replace(/\s+/g, " ") });
      continue;
    }
    const itemNo    = itemNoM[1];
    const itemNoEnd = itemNoM.index + itemNo.length;

    // Collect all "number CHF" occurrences; last 3 are: combined, discount, total
    const chfAll = [...block.matchAll(/([\d., ]+?)\s*CHF/g)];
    if (chfAll.length < 3) {
      missedRows.push({ itemNo, reason: `${chfAll.length} CHF values`, context: block.slice(0, 200).replace(/\s+/g, " ") });
      continue;
    }
    const last3       = chfAll.slice(-3);
    const combined    = last3[0][1].trim();
    const lineDiscount = parseEuropeanNumber(last3[1][1].trim());
    const lineTotal    = parseEuropeanNumber(last3[2][1].trim());

    // Tariff number (10 digits) immediately followed by gross weight digits + "gr"
    // e.g. "6206300090240,00 gr" — no space between tariff and weight in PDF output
    const tariffGrM = /(\d{10})(\d+[.,]\d+)\s*gr/.exec(block);
    if (!tariffGrM) {
      missedRows.push({ itemNo, reason: "no tariff+gr", context: block.slice(0, 200).replace(/\s+/g, " ") });
      continue;
    }
    const tariffNo  = tariffGrM[1];
    const tariffPos = tariffGrM.index;
    const grossWeight = parseEuropeanNumber(tariffGrM[2]);

    // Text between itemNo and tariff number contains: item name, colour, colourNo, category/country
    const midText = block.slice(itemNoEnd, tariffPos);

    // Colour number: 4-5 digit standalone number preceded by a lowercase letter
    // OR a single uppercase letter that itself follows a space (e.g. "Palms W 34041").
    // This prevents numbers embedded in ALL-CAPS item names (e.g. "RIGINALS 1952")
    // from matching because the uppercase S in RIGINALS is not preceded by a space.
    const colourNoM = /(?<=[a-z]|(?<=\s)[A-Z]) *(\d{4,6})(?!\d)/.exec(midText);
    const colourNo  = colourNoM ? colourNoM[1] : "";

    // Country: text after colourNo and before tariff
    const afterColourNo = colourNoM
      ? midText.slice(colourNoM.index + colourNoM[0].length)
      : midText;
    const country = extractCountry(afterColourNo.trim());

    // Item + colour name: text between itemNo and colourNo (or end of midText)
    const namePart = colourNoM
      ? midText.slice(0, colourNoM.index).trim()
      : midText.trim();
    const { item, colour } = splitItemColour(namePart);

    // Qty + price — try exact split first, fall back to best-match
    let { qty, price } = parseQtyPrice(combined, lineTotal, lineDiscount);
    if (Math.abs(round2(qty * price - lineDiscount) - lineTotal) > 0.01) {
      ({ qty, price } = bestQtyPrice(combined, lineTotal, lineDiscount));
    }

    invoice.items.push({
      itemNo, item, colour, colourNo, country, tariffNo,
      grossWeight,
      quantity: qty, pricePerPiece: price, discount: lineDiscount, total: lineTotal,
      _combined: combined,
    });
  }

  // ── STEP 2 — Validate ─────────────────────────────────────────────────────
  let parsedQty   = invoice.items.reduce((s, i) => s + i.quantity, 0);
  let parsedTotal = round2(invoice.items.reduce((s, i) => s + i.total, 0));
  let totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
  let qtyOk   = expectedQty  === null || parsedQty === expectedQty;

  // ── STEP 3 — Repair if needed ─────────────────────────────────────────────
  const repairs = [];
  if (!totalOk || !qtyOk) {
    for (const item of invoice.items) {
      const computed = round2(item.quantity * item.pricePerPiece - item.discount);
      if (Math.abs(computed - item.total) > 0.01) {
        const fixed = bestQtyPrice(item._combined, item.total, item.discount);
        repairs.push({
          itemNo: item.itemNo, item: item.item, colour: item.colour,
          combined: item._combined,
          oldQty: item.quantity, oldPrice: item.pricePerPiece,
          newQty: fixed.qty,    newPrice: fixed.price,
        });
        item.quantity      = fixed.qty;
        item.pricePerPiece = fixed.price;
      }
    }

    // ── STEP 4 — Re-validate ─────────────────────────────────────────────
    parsedQty   = invoice.items.reduce((s, i) => s + i.quantity, 0);
    parsedTotal = round2(invoice.items.reduce((s, i) => s + i.total, 0));
    totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
    qtyOk   = expectedQty  === null || parsedQty === expectedQty;
  }

  // Find item numbers present in itemsText but absent from parsed results — diagnostic
  const parsedItemNos = new Set(invoice.items.map(i => i.itemNo));
  const unparsedItemNos = [];
  for (const c of itemsText.matchAll(/(?<!\d)(\d{7}|N\d{5})(?!\d)/g)) {
    if (!parsedItemNos.has(c[1])) {
      const pos = c.index;
      unparsedItemNos.push({
        itemNo: c[1],
        context: itemsText.slice(Math.max(0, pos - 10), pos + 120).replace(/\s+/g, " "),
      });
    }
  }

  invoice._validation = {
    valid: totalOk && qtyOk,
    parsedQty, parsedTotal, expectedQty, expectedTotal,
    totalOk, qtyOk, repairs, missedRows,
    unparsedItemNos: [...new Map(unparsedItemNos.map(x => [x.itemNo, x])).values()],
  };

  // Invoice-level discount and VAT
  const invDiscM = /Discount\s+([\d.,]+)\s*CHF/i.exec(text);
  if (invDiscM) invoice.invoiceDiscount = parseEuropeanNumber(invDiscM[1]);
  const vatM = /VAT\s+([\d.,]+)\s*CHF/i.exec(text);
  if (vatM) invoice.vat = parseEuropeanNumber(vatM[1]);

  return invoice;
}

// ── Excel builder ──────────────────────────────────────────────────────────

function col(n) {
  // 1=A, 2=B, ...
  return String.fromCharCode(64 + n);
}

async function buildExcel(invoice) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "O'Neill CI Converter";
  const ws = wb.addWorksheet("Worksheet");

  const hFont    = { name: "Arial", size: 10 };
  const boldFont = { name: "Arial", size: 10, bold: true };

  const setCell = (row, colNum, value, style = {}) => {
    const cell = ws.getCell(row, colNum);
    cell.value = value;
    cell.font = style.font || hFont;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.fill)      cell.fill      = style.fill;
    if (style.border)    cell.border    = style.border;
    if (style.numFmt)    cell.numFmt    = style.numFmt;
  };

  // ── Header block ──────────────────────────────────────────────────────

  setCell(1, 1, "Delivery address", { font: boldFont });
  setCell(1, 4, "Billing address",  { font: boldFont });
  setCell(1, 8, "O'Neill Europe B.V.", { font: boldFont });

  const billingLines = [invoice.billingName, ...invoice.billingAddress];
  const oneilLines   = ["Oosteinde 32", "2361 HE Warmond", "The Netherlands", "Phone No. +31715600800"];
  for (let i = 0; i < 4; i++) {
    setCell(2 + i, 4, billingLines[i] || "");
    setCell(2 + i, 8, oneilLines[i]   || "");
  }
  setCell(6, 8, "CoC: 28036121");
  setCell(7, 8, "VAT No.: NL006028317B01");

  setCell(10, 1, "Document No.",       { font: boldFont });
  setCell(10, 3, invoice.orderNumber);
  setCell(10, 6, "Nett weight",        { font: boldFont });
  setCell(10, 8, invoice.grossWeight);
  setCell(11, 1, "Date",               { font: boldFont });
  setCell(11, 3, invoice.date);
  setCell(12, 1, "Shipment number",    { font: boldFont });
  setCell(12, 3, invoice.orderNumber);
  setCell(13, 1, "Delivery condition.", { font: boldFont });
  setCell(13, 3, invoice.deliveryTerms);
  setCell(15, 1, "Commercial invoice", { font: { name: "Arial", size: 11, bold: true } });

  // ── Column headers (row 17) — light blue fill ──────────────────────────

  const headers = [
    "Item No.", "Item", "Colour", "Colour no.", "Country of origin",
    "Tariff No.", "Gross weight", "Quantity", "Price per piece (CHF)", "Discount (CHF)", "Total (CHF)",
  ];
  const headerFill   = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEEFF" } };
  const headerBorder = { bottom: { style: "thin", color: { argb: "FF2A4457" } } };

  headers.forEach((h, i) => {
    setCell(17, i + 1, h, {
      font:      { name: "Arial", size: 10, bold: true },
      fill:      headerFill,
      border:    headerBorder,
      alignment: { horizontal: i >= 6 ? "right" : "left", vertical: "middle" },
    });
  });

  // ── Data rows ─────────────────────────────────────────────────────────

  const DATA_START = 18;

  // Pre-calculate all totals (needed as formula results for Excel caching)
  invoice.items.forEach(item => {
    item._total = round2(item.quantity * item.pricePerPiece - item.discount);
  });
  const goodsTotalQty    = invoice.items.reduce((s, it) => s + it.quantity, 0);
  const goodsTotalAmount = round2(invoice.items.reduce((s, it) => s + it._total, 0));
  const invoiceDiscount  = invoice.invoiceDiscount || 0;
  const grandTotal       = round2(goodsTotalAmount - invoiceDiscount + invoice.vat);

  invoice.items.forEach((item, idx) => {
    const r = DATA_START + idx;

    setCell(r, 1, parseInt(item.itemNo, 10), { alignment: { horizontal: "left" } });
    setCell(r, 2, item.item);
    setCell(r, 3, item.colour);
    setCell(r, 4, item.colourNo,  { alignment: { horizontal: "left" } });
    setCell(r, 5, item.country);
    setCell(r, 6, item.tariffNo,  { alignment: { horizontal: "left" } });
    setCell(r, 7, item.grossWeight,   { numFmt: "#,##0.00", alignment: { horizontal: "right" } });
    setCell(r, 8, item.quantity,      { numFmt: "#,##0",    alignment: { horizontal: "right" } });
    setCell(r, 9, item.pricePerPiece, { numFmt: "#,##0.00", alignment: { horizontal: "right" } });
    setCell(r, 10, item.discount,     { numFmt: "#,##0.00", alignment: { horizontal: "right" } });

    // Total — formula with pre-calculated result so cache is populated
    const tc    = ws.getCell(r, 11);
    tc.value    = { formula: `H${r}*I${r}-J${r}`, result: item._total };
    tc.numFmt   = "#,##0.00";
    tc.font     = hFont;
    tc.alignment = { horizontal: "right" };
  });

  // ── Summary rows ──────────────────────────────────────────────────────

  const lastDataRow  = DATA_START + invoice.items.length - 1;
  const summaryStart = lastDataRow + 2;

  const gtRow = summaryStart;
  setCell(gtRow, 1, "Goods total", { font: boldFont });
  const qtySum  = ws.getCell(gtRow, 8);
  qtySum.value  = { formula: `SUM(H${DATA_START}:H${lastDataRow})`, result: goodsTotalQty };
  qtySum.numFmt = "#,##0"; qtySum.font = boldFont; qtySum.alignment = { horizontal: "right" };
  const amtSum  = ws.getCell(gtRow, 11);
  amtSum.value  = { formula: `SUM(K${DATA_START}:K${lastDataRow})`, result: goodsTotalAmount };
  amtSum.numFmt = "#,##0.00"; amtSum.font = boldFont; amtSum.alignment = { horizontal: "right" };
  if (invoice._validation?.valid) {
    amtSum.note = `✓ Self-validated: ${goodsTotalQty} items, CHF ${goodsTotalAmount.toFixed(2)}`;
  }

  const hasDiscount = invoiceDiscount > 0;
  const discRow = hasDiscount ? summaryStart + 1 : null;
  if (hasDiscount) {
    setCell(discRow, 1, "Discount", { font: boldFont });
    const dCell    = ws.getCell(discRow, 11);
    dCell.value    = invoiceDiscount;
    dCell.numFmt   = "#,##0.00"; dCell.font = boldFont; dCell.alignment = { horizontal: "right" };
  }

  const stRow  = summaryStart + (hasDiscount ? 2 : 1);
  setCell(stRow, 1, "Subtotal", { font: boldFont });
  const stCell = ws.getCell(stRow, 11);
  const subtotalResult = round2(goodsTotalAmount - invoiceDiscount);
  stCell.value  = hasDiscount
    ? { formula: `K${gtRow}-K${discRow}`, result: subtotalResult }
    : { formula: `K${gtRow}`, result: goodsTotalAmount };
  stCell.numFmt = "#,##0.00"; stCell.font = boldFont; stCell.alignment = { horizontal: "right" };

  const vatRow = summaryStart + (hasDiscount ? 3 : 2);
  setCell(vatRow, 1, "VAT", { font: boldFont });
  const vatCell = ws.getCell(vatRow, 11);
  vatCell.value  = invoice.vat;
  vatCell.numFmt = "#,##0.00"; vatCell.font = boldFont; vatCell.alignment = { horizontal: "right" };

  const totRow = summaryStart + (hasDiscount ? 4 : 3);
  setCell(totRow, 1, "Total", { font: boldFont });
  const totCell2    = ws.getCell(totRow, 11);
  totCell2.value    = { formula: `K${stRow}+K${vatRow}`, result: grandTotal };
  totCell2.numFmt   = "#,##0.00";
  totCell2.font     = { name: "Arial", size: 10, bold: true };
  totCell2.alignment = { horizontal: "right" };

  // ── Tariff subtotals — grey fill, bold ────────────────────────────────

  const lastRow = lastDataRow;
  const tariffSectionStart = totRow + 3;
  const greyFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };

  setCell(tariffSectionStart, 1, "SUBTOTAL TARIFF NO.", { font: boldFont });
  setCell(tariffSectionStart + 1, 1, "Tariff No.", {
    font: boldFont, fill: greyFill, border: headerBorder,
  });
  setCell(tariffSectionStart + 1, 2, "Subtotal (CHF)", {
    font: boldFont, fill: greyFill, border: headerBorder, alignment: { horizontal: "right" },
  });

  const seen = new Set();
  const uniqueTariffs = [];
  for (const item of invoice.items) {
    if (!seen.has(item.tariffNo)) { seen.add(item.tariffNo); uniqueTariffs.push(item.tariffNo); }
  }

  // Build tariff→total map for pre-calculated results
  const tariffTotals = {};
  for (const item of invoice.items) {
    tariffTotals[item.tariffNo] = round2((tariffTotals[item.tariffNo] || 0) + item._total);
  }

  const tariffCol = `$F$${DATA_START}:$F$${lastRow}`;
  const totalCol  = `$K$${DATA_START}:$K$${lastRow}`;

  uniqueTariffs.forEach((tariff, i) => {
    const r = tariffSectionStart + 2 + i;
    setCell(r, 1, tariff, { font: boldFont, fill: greyFill });
    const sc     = ws.getCell(r, 2);
    sc.value     = { formula: `SUMIF(${tariffCol},A${r},${totalCol})`, result: tariffTotals[tariff] || 0 };
    sc.numFmt    = "#,##0.00";
    sc.font      = boldFont;
    sc.fill      = greyFill;
    sc.alignment = { horizontal: "right" };
  });

  // ── Auto-fit column widths based on content ───────────────────────────

  const colMaxLen = Array(11).fill(0);
  // Seed with header lengths
  headers.forEach((h, i) => { colMaxLen[i] = Math.max(colMaxLen[i], h.length); });
  // Data rows
  invoice.items.forEach(item => {
    const vals = [
      String(item.itemNo), item.item, item.colour, item.colourNo,
      item.country, item.tariffNo,
      item.grossWeight.toFixed(2), String(item.quantity),
      item.pricePerPiece.toFixed(2), item.discount.toFixed(2), "formula",
    ];
    vals.forEach((v, i) => { colMaxLen[i] = Math.max(colMaxLen[i], v.length); });
  });
  colMaxLen.forEach((len, i) => {
    ws.getColumn(i + 1).width = Math.min(Math.max(len + 2, 10), 45);
  });

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

// ── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { pdf } = req.body || {};
  if (!pdf) return res.status(400).json({ error: "Geen PDF ontvangen" });

  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdf, "base64");
  } catch {
    return res.status(400).json({ error: "Ongeldige base64-data" });
  }

  let pdfData;
  try {
    pdfData = await pdfParse(pdfBuffer);
  } catch (e) {
    return res.status(422).json({ error: `PDF kon niet worden gelezen: ${e.message}` });
  }

  const invoice = parseInvoiceText(pdfData.text);

  if (invoice.items.length === 0) {
    return res.status(422).json({
      error: "Geen factuurregels gevonden. Controleer of dit een O'Neill Commercial Invoice is.",
    });
  }

  const v = invoice._validation;
  if (v && !v.valid) {
    const allRows = invoice.items.map(it => ({
      itemNo:    it.itemNo,
      item:      it.item,
      colour:    it.colour,
      qty:       it.quantity,
      price:     it.pricePerPiece,
      discount:  it.discount,
      total:     it.total,
      calcTotal: round2(it.quantity * it.pricePerPiece - it.discount),
    }));
    return res.status(422).json({
      error: "Validatie mislukt na herstel",
      parsedQty:     v.parsedQty,
      expectedQty:   v.expectedQty,
      parsedTotal:   v.parsedTotal,
      expectedTotal: v.expectedTotal,
      missedRows:       v.missedRows,
      repairs:          v.repairs,
      unparsedItemNos:  v.unparsedItemNos,
      allRows,
    });
  }

  let xlsxBuffer;
  try {
    xlsxBuffer = await buildExcel(invoice);
  } catch (e) {
    return res.status(500).json({ error: `Excel kon niet worden aangemaakt: ${e.message}` });
  }

  const orderSlug = invoice.orderNumber
    ? invoice.orderNumber.replace(/,/g, "-")
    : invoice.date.replace(/[^0-9-]/g, "") || "invoice";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="CI_${orderSlug}.xlsx"`);
  res.setHeader("Content-Length", xlsxBuffer.byteLength);
  return res.status(200).end(Buffer.from(xlsxBuffer));
}
