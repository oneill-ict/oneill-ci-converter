import pdfParse from "pdf-parse/lib/pdf-parse.js";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

export const config = { api: { bodyParser: { sizeLimit: "10mb" } } };

// ── O'Neill item-number database ───────────────────────────────────────────
// 15K+ item codes exported from ERP. Used as fallback when the regex patterns
// don't cover a new item-number format (e.g. 6-digit codes, mixed alphanumeric).
// Use explicit dirname(fileURLToPath(...)) so Vercel's file tracer picks up item-db.json.
const _dbPath    = join(dirname(fileURLToPath(import.meta.url)), "item-db.json");
const _itemDbArr = JSON.parse(readFileSync(_dbPath, "utf8"));
const ITEM_DB     = new Set(_itemDbArr);
const ITEM_PREFIX = new Set();
for (const code of ITEM_DB) {
  for (let i = 1; i <= code.length; i++) ITEM_PREFIX.add(code.slice(0, i));
}

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
  // Two discount formats exist across invoice types:
  //   Format A (line discount):    total = qty × price - disc_total   → qty×price ≈ total+disc
  //   Format B (per-unit discount): total = qty × (price - disc_unit) → total/qty ≈ price-disc
  const s        = combined.trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0, discMult: 1 };
  const intPart      = s.slice(0, commaIdx);
  const decPart      = s.slice(commaIdx + 1).trim();
  const expectedProd = round2(totalCHF + discountCHF);

  // Pass 1 — line-discount format (standard CH invoices)
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceIntRaw = intPart.slice(qLen);
    const priceInt = priceIntRaw.replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price)) continue;
    if (Math.abs(round2(qty * price) - expectedProd) < 0.02) return { qty, price, discMult: 1 };
  }

  // Pass 2 — per-unit discount format (e.g. Bens Surf Clinic / distributor invoices)
  // Uses per-piece tolerance to absorb rounding in the per-unit discount value.
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceInt = intPart.slice(qLen).replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price) || qty === 0) continue;
    if (Math.abs(totalCHF / qty - (price - discountCHF)) < 0.02) return { qty, price, discMult: qty };
  }

  return { qty: parseInt(intPart, 10), price: parseFloat(`0.${decPart}`), discMult: 1 };
}

function bestQtyPrice(combined, totalCHF, discountCHF = 0) {
  const s        = combined.trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0, discMult: 1 };
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
    if (isNaN(qty) || isNaN(price) || qty === 0) continue;
    // Format A: line-discount diff
    const diff1 = Math.abs(round2(qty * price) - target);
    if (diff1 < bestDiff) { bestDiff = diff1; best = { qty, price, discMult: 1 }; }
    // Format B: per-unit discount diff (scale to absolute amount for fair comparison)
    const diff2 = Math.abs(totalCHF / qty - (price - discountCHF)) * qty;
    if (diff2 < bestDiff) { bestDiff = diff2; best = { qty, price, discMult: qty }; }
  }
  return best || { qty: parseInt(intPart, 10), price: parseFloat(`0.${decPart}`), discMult: 1 };
}

function extractCountry(groupCountry) {
  const trimmed = groupCountry.trim();
  // Case 1: item group concatenated directly to country (e.g. "FootwearChina",
  // "BlousesIndia") — split at lowercase→uppercase boundary.
  const idx = trimmed.search(/(?<=[a-z])(?=[A-Z])/);
  if (idx > 0) return trimmed.slice(idx).trim();
  // Case 2: multi-word item group separated by spaces (e.g. "Dresses & Jumpsuits India",
  // "Tops & Blouses Bangladesh") — country is always the last word.
  const words = trimmed.split(/\s+/);
  return words[words.length - 1] || trimmed;
}

// Returns the longest item code from ITEM_DB that starts at text[pos],
// or null if nothing matches. minLen guards against 2-3 char false positives.
function findDbItemAt(text, pos, minLen = 4) {
  let last = null;
  for (let end = pos + minLen; end <= Math.min(pos + 18, text.length); end++) {
    const cand = text.slice(pos, end);
    if (!ITEM_PREFIX.has(cand)) break;
    if (ITEM_DB.has(cand)) last = cand;
  }
  return last;
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

  // Detect invoice currency (CHF for Switzerland, EUR for other countries)
  const currencyM = /\b(CHF|EUR|GBP)\b/.exec(text);
  invoice.currency = currencyM ? currencyM[1] : "CHF";

  // Stop at "O'Neill Europe B.V." — the shipper block always follows the billing
  // address, regardless of destination country (CH, MT, etc.).
  // Previously used "Switzerland" which broke non-CH invoices (e.g. Malta/EUR),
  // and before that "O'Neill" which broke B2C invoices where the recipient is O'Neill.
  const billingBlock = /Billing address\s+([\s\S]+?)O'Neill Europe B\.V\./i.exec(text);
  if (billingBlock) {
    const addrLines = billingBlock[1].trim().split(/\n/).map(l => l.trim()).filter(Boolean);
    invoice.billingName    = addrLines[0] || "";
    invoice.billingAddress = addrLines.slice(1);
  }

  // ── Auto-city: append destination city to DDP delivery terms ──────────────
  // Looks for a postal-code line in the ship-to address (e.g. "CH-4303 Kaiseraugst")
  const _cityM = (invoice.billingAddress || [])
    .map(l => /(?:[A-Z]{2}-\d{3,5}|\d{3,5}(?:\s+[A-Z]{2})?)\s+([A-Za-züöäÜÖÄ][A-Za-züöäÜÖÄ\-]+)/.exec(l))
    .find(Boolean);
  if (_cityM && invoice.deliveryTerms === "DDP") {
    invoice.deliveryTerms = `DDP ${_cityM[1].trim()}`;
  }

  // ── B2B detection: Spedag / Kaiseraugst ship-to = B2B invoice ─────────────
  invoice.isB2B = [invoice.billingName, ...(invoice.billingAddress || [])].some(l =>
    /spedag|kaiseraugst/i.test(l)
  );

  // ── Normalise text ────────────────────────────────────────────────────────
  // Collapse newlines to spaces so multi-line PDF cells don't break the regex.
  // Restrict to the items section to prevent false matches in the header block.
  // Collapse newlines; then re-merge digit pairs that were split across lines
  // e.g. PDF "2100\n049" → "2100 049" → "2100049" so item numbers stay intact.
  let flatText = text.replace(/\n/g, " ");
  flatText = flatText.replace(/(?<!\d)(\d{2,6}) (\d{1,6})(?!\d)/g, (m, a, b) => {
    const combined = a + b;
    return combined.length === 7 ? combined : m;
  });
  // Strip inter-page boilerplate (e.g. German origin disclaimer on CH invoices).
  // This text appears between items on multi-page invoices and prevents the split
  // regex from finding the correct boundary before the next item number.
  flatText = flatText.replace(/Bei Waren[\s\S]*?(?=\d{4}[A-Z]|\d{7,8}|N\d{5,7})/g, '');
  // Collapse multiple spaces after currency symbols so the split lookbehind (fixed-length)
  // can match "CHF " regardless of how many spaces the PDF layout left behind.
  flatText = flatText.replace(/(CHF|EUR|GBP) {2,}/g, '$1 ');
  const itemsStart = flatText.indexOf("DiscountTotal");

  // Determine where the items section ends.
  // Primary: "SUBTOTAL TARIFF NO." — the tariff breakdown header always follows
  //   all items (including NOS items that appear after a per-page "Goods total"
  //   subtotal). This is safer than stopping at "Goods total" which can appear
  //   in the middle of the document as a running page subtotal.
  // Fallback: last "goods total" occurrence — for invoices without tariff subtotals.
  const flatLower  = flatText.toLowerCase();
  let itemsEnd     = flatLower.indexOf("subtotal tariff no.");
  if (itemsEnd < 0) itemsEnd = flatLower.lastIndexOf("goods total");
  const itemsText  = itemsStart >= 0 && itemsEnd > itemsStart
    ? flatText.slice(itemsStart, itemsEnd)
    : itemsStart >= 0 ? flatText.slice(itemsStart) : flatText;

  // Expected totals — read from the LAST "Goods total N CHF/EUR" line (the grand total).
  // Scan the full flatText so intermediate per-page subtotals don't shadow the real total.
  let lastGtM = null;
  for (const m of flatText.matchAll(/Goods total\s*(\d+)\s+([\d.,]+)\s*(?:CHF|EUR|GBP)/gi)) {
    lastGtM = m;
  }
  const expectedQty   = lastGtM ? parseInt(lastGtM[1], 10) : null;
  const expectedTotal = lastGtM ? parseEuropeanNumber(lastGtM[2]) : null;

  // ── STEP 1 — Split text into per-item blocks ─────────────────────────────
  // Split on item-number boundaries.
  // \d{7,8}: covers standard 7-digit items AND 8-digit items (e.g. 90261039).
  // (?<![\dN]): prevents splitting at the digit portion of N-prefixed items
  //   (e.g. N1800006 must not create a separate split at its embedded 1800006).
  // N\d{5,7}: N-prefixed items (N+5 to N+7 digits).
  // (?<=CHF/EUR/GBP )\d{4}[A-Z]: alphanumeric items (e.g. 4868G, 5045B) that appear
  //   immediately after a CHF/EUR/GBP total line (collapsed newline becomes space).
  const splitRe = /(?<![\dN])(?=\d{7,8}(?!\d))|(?<!\d)(?=N\d{5,7}(?!\d))|(?<=(?:CHF|EUR|GBP) )(?=\d{4}[A-Z])|(?<=(?:CHF|EUR|GBP) )(?=ONS[A-Z])/g;
  const blocks  = itemsText.split(splitRe).filter(b => b.trim());

  // ── STEP 2 — Parse each block independently ───────────────────────────────
  // blocks is a plain Array (from split), so splice() is safe during iteration.
  const missedRows = [];
  for (let _bi = 0; _bi < blocks.length; _bi++) {
    const block = blocks[_bi];
    // Item number: 7-8 digit, N+5..7 digit, or alphanumeric at block start (e.g. 4868G).
    const itemNoM = /(?<![\dN])(\d{7,8})(?!\d)|(?<!\d)(N\d{5,7})(?!\d)|^(\d{4}[A-Z])|^(ONS[A-Z]+)/.exec(block);
    // If regex finds nothing, try the ERP item-number database as fallback.
    // This covers formats not in the regex: 6-digit codes (006300), mixed alphanumeric
    // (101230ON), long eyewear codes (10BRPK1005BLCK), etc.
    let itemNo, itemNoEnd;
    if (itemNoM) {
      itemNo    = itemNoM[1] || itemNoM[2] || itemNoM[3] || itemNoM[4];
      itemNoEnd = itemNoM.index + itemNoM[0].length;
    } else {
      const trimmed = block.trimStart();
      const leadWs  = block.length - trimmed.length;
      const dbItem  = findDbItemAt(trimmed, 0);
      const nextCh  = dbItem ? (trimmed[dbItem.length] || '') : '';
      if (dbItem && /[A-Z0-9\-']/.test(nextCh)) {
        itemNo    = dbItem;
        itemNoEnd = leadWs + dbItem.length;
      } else {
        missedRows.push({ itemNo: "???", reason: "no item number in block", context: block.slice(0, 150).replace(/\s+/g, " ") });
        continue;
      }
    }

    // Tariff number (10 digits) immediately followed by gross weight digits + "gr"
    // e.g. "6206300090240,00 gr" — no space between tariff and weight in PDF output.
    // Finding tariff FIRST so we can read CHF values after it, ignoring any footer
    // amounts (Goods total, VAT, Total) that may appear later in the same block.
    const tariffGrM = /(\d{10})(\d[\d.]*,\d+)\s*gr/.exec(block);
    if (!tariffGrM) {
      missedRows.push({ itemNo, reason: "no tariff+gr", context: block.slice(0, 200).replace(/\s+/g, " ") });
      continue;
    }
    const tariffNo    = tariffGrM[1];
    const tariffPos   = tariffGrM.index;
    const grossWeight = parseEuropeanNumber(tariffGrM[2]);

    // CHF values immediately after the tariff: combined (qty×price), discount, total.
    // Using first-3-after-tariff instead of last-3-in-block prevents the last item's
    // block from picking up footer CHF amounts (Goods total, Subtotal, VAT, Total)
    // that appear between the last item and SUBTOTAL TARIFF NO.
    const afterTariffText = block.slice(tariffPos + tariffGrM[0].length);
    const chfAfterTariff  = [...afterTariffText.matchAll(/([\d., ]+?)\s*(?:CHF|EUR|GBP)/g)];
    if (chfAfterTariff.length < 3) {
      missedRows.push({ itemNo, reason: `${chfAfterTariff.length} CHF values after tariff`, context: block.slice(0, 200).replace(/\s+/g, " ") });
      continue;
    }
    const first3       = chfAfterTariff.slice(0, 3);
    const combined     = first3[0][1].trim();
    const lineDiscount = parseEuropeanNumber(first3[1][1].trim());
    const lineTotal    = parseEuropeanNumber(first3[2][1].trim());

    // Embedded-item check: if the block tail (after item A's 3rd CHF value) contains
    // another tariff code, a second item is embedded. Split it off so the next loop
    // iteration processes it as its own block.
    const _tariffBase  = tariffPos + tariffGrM[0].length;
    const _firstItemEnd = _tariffBase + first3[2].index + first3[2][0].length;
    const _embTail     = block.slice(_firstItemEnd).trimStart();
    if (_embTail.length > 20 && /\d{10}/.test(_embTail)) {
      blocks.splice(_bi + 1, 0, _embTail);
    }

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

    // Qty + price — try exact split first, fall back to best-match.
    // discMult=1 → line-discount format (discount stored as-is).
    // discMult=qty → per-unit discount format (discount × qty = total line discount).
    let { qty, price, discMult } = parseQtyPrice(combined, lineTotal, lineDiscount);
    if (Math.abs(round2(qty * price - lineDiscount * discMult) - lineTotal) > 0.01) {
      ({ qty, price, discMult } = bestQtyPrice(combined, lineTotal, lineDiscount));
    }
    const storedDiscount = round2(lineDiscount * discMult);

    invoice.items.push({
      itemNo, item, colour, colourNo, country, tariffNo,
      grossWeight,
      quantity: qty, pricePerPiece: price, discount: storedDiscount, total: lineTotal,
      _combined: combined, _origDiscount: lineDiscount,
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
        const fixed = bestQtyPrice(item._combined, item.total, item._origDiscount ?? item.discount);
        repairs.push({
          itemNo: item.itemNo, item: item.item, colour: item.colour,
          combined: item._combined,
          oldQty: item.quantity, oldPrice: item.pricePerPiece,
          newQty: fixed.qty,    newPrice: fixed.price,
        });
        item.quantity      = fixed.qty;
        item.pricePerPiece = fixed.price;
        item.discount      = round2((item._origDiscount ?? item.discount) * fixed.discMult);
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
  for (const c of itemsText.matchAll(/(?<![\dN])(\d{7,8})(?!\d)|(?<!\d)(N\d{5,7})(?!\d)/g)) {
    const itemNum = c[1] || c[2];
    if (!parsedItemNos.has(itemNum)) {
      const pos = c.index;
      unparsedItemNos.push({
        itemNo: itemNum,
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
  const invDiscM = /Discount\s+([\d.,]+)\s*(?:CHF|EUR|GBP)/i.exec(text);
  if (invDiscM) invoice.invoiceDiscount = parseEuropeanNumber(invDiscM[1]);
  const vatM = /VAT\s+([\d.,]+)\s*(?:CHF|EUR|GBP)/i.exec(text);
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
  const ws = wb.addWorksheet("Commercial Invoice");

  // No freeze pane — hide gridlines only for clean document look
  ws.views = [{ showGridLines: false }];

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
  setCell(10, 1, "Order number / Invoice nr.:", { font: boldFont });
  setCell(10, 3, orderSuggestion || invoice.orderNumber);

  // Row 11: Delivery terms
  setCell(11, 1, "Delivery terms:", { font: boldFont });
  setCell(11, 3, invoice.deliveryTerms || "DDP");

  // Row 12: Nett weight
  setCell(12, 1, "Nett weight:", { font: boldFont });
  setCell(12, 3, nettWeightStr);

  // Row 13: Gross weight — empty, fill in manually
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

  // Pre-calculate all totals (needed as formula results for Excel caching)
  invoice.items.forEach(item => {
    item._total = round2(item.quantity * item.pricePerPiece - item.discount);
  });
  const goodsTotalQty    = invoice.items.reduce((s, it) => s + it.quantity, 0);
  const goodsTotalAmount = round2(invoice.items.reduce((s, it) => s + it._total, 0));
  const invoiceDiscount  = invoice.invoiceDiscount || 0;
  const grandTotal       = round2(goodsTotalAmount - invoiceDiscount + invoice.vat);

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
      cell.value = value;
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
    cd(7,  item.grossWeight,   { numFmt: "#,##0.00", alignment: { horizontal: "right" } });
    cd(8,  item.quantity,      { numFmt: "#,##0",    alignment: { horizontal: "right" } });
    cd(9,  item.pricePerPiece, { numFmt: "#,##0.00", alignment: { horizontal: "right" } });
    cd(10, item.discount,      { numFmt: "#,##0.00", alignment: { horizontal: "right" } });

    // Total — formula with pre-calculated result so cache is populated
    const tc     = ws.getCell(r, 11);
    tc.value     = { formula: `H${r}*I${r}-J${r}`, result: item._total };
    tc.numFmt    = "#,##0.00";
    tc.font      = hFont;
    tc.alignment = { horizontal: "right" };
    if (altFill) tc.fill = altFill;
    tc.border    = bdr;

    ws.getRow(r).height = 15.75;
  });

  // ── Summary rows ──────────────────────────────────────────────────────

  const summaryStart = lastDataRow + 2;

  const gtRow = summaryStart;
  setCell(gtRow, 1, "Goods total", { font: boldFont, border: summaryBorder });
  const qtySum  = ws.getCell(gtRow, 8);
  qtySum.value  = { formula: `SUM(H${DATA_START}:H${lastDataRow})`, result: goodsTotalQty };
  qtySum.numFmt = "#,##0"; qtySum.font = boldFont; qtySum.alignment = { horizontal: "right" }; qtySum.border = summaryBorder;
  const amtSum  = ws.getCell(gtRow, 11);
  amtSum.value  = { formula: `SUM(K${DATA_START}:K${lastDataRow})`, result: goodsTotalAmount };
  amtSum.numFmt = "#,##0.00"; amtSum.font = boldFont; amtSum.alignment = { horizontal: "right" }; amtSum.border = summaryBorder;

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
  setCell(totRow, 1, "Total", { font: { name: "Arial", size: 11, bold: true } });
  const totCell2    = ws.getCell(totRow, 11);
  totCell2.value    = { formula: `K${stRow}+K${vatRow}`, result: grandTotal };
  totCell2.numFmt   = "#,##0.00";
  totCell2.font     = { name: "Arial", size: 11, bold: true };
  totCell2.alignment = { horizontal: "right" };

  // ── Tariff subtotals ──────────────────────────────────────────────────

  const lastRow = lastDataRow;
  const tariffSectionStart = totRow + 3;

  setCell(tariffSectionStart, 1, "SUBTOTAL TARIFF NO.", { font: boldFont });
  setCell(tariffSectionStart + 1, 1, "Tariff No.", {
    font: { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } },
    fill: tariffHdrFill, border: headerBorder,
  });
  setCell(tariffSectionStart + 1, 2, "Subtotal (CHF)", {
    font: { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } },
    fill: tariffHdrFill, border: headerBorder, alignment: { horizontal: "right" },
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
    const r    = tariffSectionStart + 2 + i;
    const fill = i % 2 === 1 ? greyFill : null;
    setCell(r, 1, tariff, { font: boldFont, ...(fill ? { fill } : {}) });
    const sc     = ws.getCell(r, 2);
    sc.value     = { formula: `SUMIF(${tariffCol},A${r},${totalCol})`, result: tariffTotals[tariff] || 0 };
    sc.numFmt    = "#,##0.00";
    sc.font      = boldFont;
    if (fill) sc.fill = fill;
    sc.alignment = { horizontal: "right" };
  });

  // ── Legal / customs footer ────────────────────────────────────────────────
  // Swiss-specific footer (Turkish origin + ZAZ + VAT/UID + optional B2B agent)
  // only applies to CHF invoices destined for Switzerland.
  const footerStart = tariffSectionStart + uniqueTariffs.length + 3;
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

  const { pdf, filename, force } = req.body || {};
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
    console.log(JSON.stringify({ event: "ci_no_items", filename: filename || null, currency: invoice.currency }));
    return res.status(422).json({
      error: "Geen factuurregels gevonden. Controleer of dit een O'Neill Commercial Invoice is.",
    });
  }

  const v = invoice._validation;

  // Structured log for every conversion — visible in Vercel function logs.
  // Fires regardless of outcome so we can spot patterns without waiting for user reports.
  console.log(JSON.stringify({
    event:          "ci_conversion",
    filename:       filename || null,
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
      unparsedItemNos:  v.unparsedItemNos,
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
  if (filename) {
    exportName = filename.replace(/\.[^.]+$/, ""); // strip extension
  } else {
    const orderSlug = invoice.orderNumber
      ? invoice.orderNumber.replace(/,/g, "-")
      : invoice.date.replace(/[^0-9-]/g, "") || "invoice";
    exportName = `CI_${orderSlug}`;
  }
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${exportName}.xlsx"`);
  res.setHeader("Content-Length", xlsxBuffer.byteLength);
  // Expose validation stats so the frontend can show a summary
  res.setHeader("X-Validation-Qty",   String(invoice._validation?.parsedQty   ?? ""));
  res.setHeader("X-Validation-Total", String(invoice._validation?.parsedTotal ?? ""));
  // Expose unparsed item numbers even on success so the frontend can show a soft warning
  const unparsedNos = (v?.unparsedItemNos || []).map(r => r.itemNo);
  if (unparsedNos.length > 0) {
    res.setHeader("X-Unparsed-Items", JSON.stringify(unparsedNos));
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
  res.setHeader("X-Preview", JSON.stringify(previewRows));
  return res.status(200).end(Buffer.from(xlsxBuffer));
}
