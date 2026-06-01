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
  const words = combined.trim().split(/\s+/);
  let splitIdx = words.length;
  for (let i = 1; i < words.length; i++) {
    // Colour name starts with uppercase then lowercase (Title Case)
    if (/^[A-Z][a-z]/.test(words[i])) {
      splitIdx = i;
      break;
    }
  }
  return {
    item: words.slice(0, splitIdx).join(" "),
    colour: words.slice(splitIdx).join(" "),
  };
}

function parseInvoiceText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const invoice = {
    date: "",
    orderNumber: "",
    deliveryTerms: "",
    vatNumber: "",
    numberOfBoxes: "",
    grossWeight: "",
    billingName: "",
    billingAddress: [],
    items: [],
    goodsTotalQty: 0,
    goodsTotalAmount: 0,
    subtotal: 0,
    vat: 0,
    total: 0,
  };

  // Header fields
  for (const line of lines) {
    if (/^Date:\s*/i.test(line))            invoice.date          = line.replace(/^Date:\s*/i, "").trim();
    if (/^Order number:\s*/i.test(line))    invoice.orderNumber   = line.replace(/^Order number:\s*/i, "").trim();
    if (/^Delivery terms:\s*/i.test(line))  invoice.deliveryTerms = line.replace(/^Delivery terms:\s*/i, "").trim();
    if (/^Number of boxes:\s*/i.test(line)) invoice.numberOfBoxes = line.replace(/^Number of boxes:\s*/i, "").trim();
    if (/^Gross weight:\s*/i.test(line))    invoice.grossWeight   = line.replace(/^Gross weight:\s*/i, "").trim();
    // Second "VAT number:" is the customer's (billing party)
    if (/^VAT number:\s*/i.test(line) && !invoice.date) {
      // skip — first VAT number is O'Neill's own
    }
  }

  // Billing address: lines between "Billing address" and "O'Neill"
  let inBilling = false;
  for (const line of lines) {
    if (/^Billing address$/i.test(line)) { inBilling = true; continue; }
    if (inBilling) {
      if (/^O'Neill/i.test(line)) break;
      if (invoice.billingName === "") invoice.billingName = line;
      else invoice.billingAddress.push(line);
    }
  }

  // Line items regex:
  // {7digits} {item+colour} {4-5digits} {itemgroup+country} {10digits} {weight},00 gr {qty} {price},xx CHF {discount},xx CHF {total},xx CHF
  const lineRe = /^(\d{7})\s+(.+?)\s+(\d{4,5})\s+(.+?)\s+(\d{10})\s+([\d.]+,\d{2})\s+gr\s+(\d+)\s+([\d.]+,\d{2})\s+CHF\s+([\d.]+,\d{2})\s+CHF\s+([\d.]+,\d{2})\s+CHF/;

  for (const line of lines) {
    const m = lineRe.exec(line);
    if (!m) continue;

    const { item, colour } = splitItemColour(m[2]);
    // Country is the last word of group 4 (item group + country)
    const countryWords = m[4].trim().split(/\s+/);
    const country = countryWords[countryWords.length - 1];

    invoice.items.push({
      itemNo:       m[1],
      item,
      colour,
      colourNo:     m[3],
      country,
      tariffNo:     m[5],
      grossWeight:  parseEuropeanNumber(m[6]),
      quantity:     parseInt(m[7], 10),
      pricePerPiece: parseEuropeanNumber(m[8]),
      discount:     parseEuropeanNumber(m[9]),
      total:        parseEuropeanNumber(m[10]),
    });
  }

  // Summary totals
  for (const line of lines) {
    const goodsM = /^Goods total\s+([\d]+)\s+([\d.,]+)\s+CHF/i.exec(line);
    if (goodsM) {
      invoice.goodsTotalQty    = parseInt(goodsM[1], 10);
      invoice.goodsTotalAmount = parseEuropeanNumber(goodsM[2]);
    }
    const subM = /^Subtotal\s+([\d.,]+)\s+CHF/i.exec(line);
    if (subM) invoice.subtotal = parseEuropeanNumber(subM[1]);

    const vatM = /^VAT\s+([\d.,]+)\s+CHF/i.exec(line);
    if (vatM) invoice.vat = parseEuropeanNumber(vatM[1]);

    const totalM = /^Total\s+([\d.,]+)\s+CHF/i.exec(line);
    if (totalM) invoice.total = parseEuropeanNumber(totalM[1]);
  }

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

  // Column widths (A..K)
  const widths = [18, 36, 18, 12, 18, 14, 14, 10, 16, 12, 14];
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // ── Header block ──────────────────────────────────────────────────────

  const hFont = { name: "Arial", size: 10 };
  const boldFont = { name: "Arial", size: 10, bold: true };

  const setCell = (row, colNum, value, style = {}) => {
    const cell = ws.getCell(row, colNum);
    cell.value = value;
    cell.font = style.font || hFont;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.fill) cell.fill = style.fill;
    if (style.border) cell.border = style.border;
    if (style.numFmt) cell.numFmt = style.numFmt;
  };

  // Row 1: labels
  setCell(1, 1, "Delivery address", { font: boldFont });
  setCell(1, 4, "Billing address", { font: boldFont });
  setCell(1, 8, "O'Neill Europe B.V.", { font: boldFont });

  // Billing address lines (rows 2-5)
  const billingLines = [invoice.billingName, ...invoice.billingAddress];
  const oneilLines   = ["Oosteinde 32", "2361 HE Warmond", "The Netherlands", "Phone No. +31715600800"];
  for (let i = 0; i < 4; i++) {
    setCell(2 + i, 4, billingLines[i] || "");
    setCell(2 + i, 8, oneilLines[i] || "");
  }
  setCell(6, 8, "CoC: 28036121");
  setCell(7, 8, "VAT No.: NL006028317B01");

  // Row 10: Document No., weight
  setCell(10, 1, "Document No.", { font: boldFont });
  setCell(10, 3, invoice.orderNumber);
  setCell(10, 6, "Nett weight", { font: boldFont });
  setCell(10, 8, invoice.grossWeight);

  setCell(11, 1, "Date", { font: boldFont });
  setCell(11, 3, invoice.date);

  setCell(12, 1, "Shipment number", { font: boldFont });
  setCell(12, 3, invoice.orderNumber);

  setCell(13, 1, "Delivery condition.", { font: boldFont });
  setCell(13, 3, invoice.deliveryTerms);

  // Row 15: section title
  setCell(15, 1, "Commercial invoice", { font: { name: "Arial", size: 11, bold: true } });

  // ── Column headers (row 17) ────────────────────────────────────────────

  const headers = ["Item No.", "Item", "Colour", "Colour no.", "Country of origin", "Tariff No.", "Gross weight", "Quantity", "Price per piece", "Discount", "Total"];
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2F42" } };
  const headerBorder = {
    bottom: { style: "thin", color: { argb: "FF2A4457" } },
  };

  headers.forEach((h, i) => {
    setCell(17, i + 1, h, {
      font: { name: "Arial", size: 10, bold: true, color: { argb: "FFE0EEF2" } },
      fill: headerFill,
      border: headerBorder,
      alignment: { horizontal: i >= 6 ? "right" : "left", vertical: "middle" },
    });
  });

  // ── Data rows ─────────────────────────────────────────────────────────

  const DATA_START = 18;
  const altFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF152739" } };

  invoice.items.forEach((item, idx) => {
    const r = DATA_START + idx;
    const isAlt = idx % 2 === 1;
    const rowFill = isAlt ? altFill : undefined;

    const numStyle = (extra = {}) => ({
      font: hFont, numFmt: "#,##0.00", alignment: { horizontal: "right" },
      ...(isAlt ? { fill: rowFill } : {}),
      ...extra,
    });
    const txtStyle = isAlt ? { font: hFont, fill: rowFill } : { font: hFont };

    setCell(r, 1, parseInt(item.itemNo, 10), { ...txtStyle, font: { ...hFont, color: { argb: "FF6E8FA3" } }, alignment: { horizontal: "left" } });
    setCell(r, 2, item.item, txtStyle);
    setCell(r, 3, item.colour, txtStyle);
    setCell(r, 4, item.colourNo, { ...txtStyle, alignment: { horizontal: "left" } });
    setCell(r, 5, item.country, txtStyle);
    setCell(r, 6, item.tariffNo, { ...txtStyle, font: { name: "Arial", size: 10, color: { argb: "FF6E8FA3" } }, alignment: { horizontal: "left" } });
    setCell(r, 7, item.grossWeight, numStyle());
    setCell(r, 8, item.quantity, { ...numStyle(), numFmt: "#,##0" });

    // Price per piece — hardcoded value (input from PDF)
    setCell(r, 9, item.pricePerPiece, numStyle());

    // Discount — hardcoded value (input from PDF)
    setCell(r, 10, item.discount, numStyle());

    // Total — Excel formula: Qty * Price - Discount
    const qtyCell      = `${col(8)}${r}`;
    const priceCell    = `${col(9)}${r}`;
    const discountCell = `${col(10)}${r}`;
    const totalCell    = ws.getCell(r, 11);
    totalCell.value    = { formula: `${qtyCell}*${priceCell}-${discountCell}` };
    totalCell.numFmt   = "#,##0.00";
    totalCell.font     = hFont;
    totalCell.alignment = { horizontal: "right" };
    if (isAlt) totalCell.fill = rowFill;
  });

  // ── Summary rows ──────────────────────────────────────────────────────

  const itemCount = invoice.items.length;
  const lastDataRow = DATA_START + itemCount - 1;
  const summaryStart = lastDataRow + 2;

  const boldRight = { font: boldFont, alignment: { horizontal: "right" }, numFmt: "#,##0.00" };

  // Goods total
  const gtRow = summaryStart;
  setCell(gtRow, 1, "Goods total", { font: boldFont });
  // Qty SUM formula
  const qtySum = ws.getCell(gtRow, 8);
  qtySum.value  = { formula: `SUM(H${DATA_START}:H${lastDataRow})` };
  qtySum.numFmt = "#,##0";
  qtySum.font   = boldFont;
  qtySum.alignment = { horizontal: "right" };
  // Amount SUM formula
  const amtSum = ws.getCell(gtRow, 11);
  amtSum.value  = { formula: `SUM(K${DATA_START}:K${lastDataRow})` };
  amtSum.numFmt = "#,##0.00";
  amtSum.font   = boldFont;
  amtSum.alignment = { horizontal: "right" };

  // Subtotal = same as goods total amount
  const stRow = summaryStart + 1;
  setCell(stRow, 1, "Subtotal", { font: boldFont });
  const stCell = ws.getCell(stRow, 11);
  stCell.value  = { formula: `K${gtRow}` };
  stCell.numFmt = "#,##0.00";
  stCell.font   = boldFont;
  stCell.alignment = { horizontal: "right" };

  // VAT — extracted from PDF (tax data, not a formula)
  const vatRow = summaryStart + 2;
  setCell(vatRow, 1, "VAT", { font: boldFont });
  setCell(vatRow, 11, invoice.vat, { ...boldRight });

  // Total = Subtotal + VAT
  const totRow = summaryStart + 3;
  setCell(totRow, 1, "Total", { font: boldFont });
  const totCell = ws.getCell(totRow, 11);
  totCell.value  = { formula: `K${stRow}+K${vatRow}` };
  totCell.numFmt = "#,##0.00";
  totCell.font   = { name: "Arial", size: 10, bold: true, color: { argb: "FF26B5A8" } };
  totCell.alignment = { horizontal: "right" };

  // ── Tariff subtotals ──────────────────────────────────────────────────

  const tariffSectionStart = totRow + 3;
  setCell(tariffSectionStart, 1, "SUBTOTAL TARIFF NO.", { font: { name: "Arial", size: 10, bold: true } });
  setCell(tariffSectionStart + 1, 1, "Tariff No.", { font: boldFont });
  setCell(tariffSectionStart + 1, 2, "Subtotal", { font: boldFont, alignment: { horizontal: "right" } });

  // Unique tariff numbers (preserve order of first appearance)
  const seen = new Set();
  const uniqueTariffs = [];
  for (const item of invoice.items) {
    if (!seen.has(item.tariffNo)) {
      seen.add(item.tariffNo);
      uniqueTariffs.push(item.tariffNo);
    }
  }

  const tariffCol  = `F${DATA_START}:F${lastDataRow}`;  // Tariff No. column F
  const totalCol   = `K${DATA_START}:K${lastDataRow}`;  // Total column K

  uniqueTariffs.forEach((tariff, i) => {
    const r = tariffSectionStart + 2 + i;
    setCell(r, 1, tariff, { font: { name: "Arial", size: 10, color: { argb: "FF6E8FA3" } } });
    const sumCell = ws.getCell(r, 2);
    sumCell.value  = { formula: `SUMIF(${tariffCol},A${r},${totalCol})` };
    sumCell.numFmt = "#,##0.00";
    sumCell.font   = hFont;
    sumCell.alignment = { horizontal: "right" };
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
    return res.status(422).json({ error: "Geen factuurregels gevonden. Controleer of dit een O'Neill Commercial Invoice is." });
  }

  let xlsxBuffer;
  try {
    xlsxBuffer = await buildExcel(invoice);
  } catch (e) {
    return res.status(500).json({ error: `Excel kon niet worden aangemaakt: ${e.message}` });
  }

  const dateStr = invoice.date.replace(/[^0-9-]/g, "") || "invoice";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="commercial-invoice-${dateStr}.xlsx"`);
  res.setHeader("Content-Length", xlsxBuffer.byteLength);
  return res.status(200).end(Buffer.from(xlsxBuffer));
}
