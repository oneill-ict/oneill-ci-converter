// Self-validation test against real PDF
// Run: node test-selfvalidate.mjs
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { readFileSync } from "fs";

const round2 = (n) => Math.round(n * 100) / 100;
function parseEuropeanNumber(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}
function splitItemColour(combined) {
  const idx = combined.search(/(?<=[A-Z0-9\-'"&\s])(?=[A-Z][a-z])/);
  if (idx > 0) return { item: combined.slice(0, idx).trim(), colour: combined.slice(idx).trim() };
  return { item: combined.trim(), colour: "" };
}
function parseQtyPrice(combined, totalCHF, discountCHF = 0) {
  const s = combined.trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0 };
  const intPart = s.slice(0, commaIdx);
  const decPart = s.slice(commaIdx + 1).trim();
  const expectedProd = round2(totalCHF + discountCHF);
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceIntRaw = intPart.slice(qLen);
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
  const s = combined.trim();
  const commaIdx = s.indexOf(",");
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0 };
  const intPart = s.slice(0, commaIdx);
  const decPart = s.slice(commaIdx + 1).trim();
  const target  = round2(totalCHF + discountCHF);
  let bestDiff = Infinity, best = null;
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceIntRaw = intPart.slice(qLen);
    const priceInt = priceIntRaw.replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price)) continue;
    const diff  = Math.abs(round2(qty * price) - target);
    if (diff < bestDiff) { bestDiff = diff; best = { qty, price }; }
  }
  return best || { qty: parseInt(intPart, 10), price: parseFloat(`0.${decPart}`) };
}
function extractCountry(g) {
  const idx = g.search(/(?<=[a-z])(?=[A-Z])/);
  return idx > 0 ? g.slice(idx).trim() : g.trim();
}

// ── Parse PDF ────────────────────────────────────────────────────────────────
const data = await pdfParse(readFileSync("CommercialInvoice-.pdf"));
const text = data.text;
const flatText   = text.replace(/\n/g, " ");
const itemsStart = flatText.indexOf("DiscountTotal");
const itemsEnd   = flatText.search(/Goods total/i);
const itemsText  = itemsStart >= 0 && itemsEnd > itemsStart
  ? flatText.slice(itemsStart, itemsEnd)
  : flatText;

const gtM          = /Goods total\s*(\d+)\s+([\d.,]+)\s*CHF/i.exec(flatText);
const expectedQty   = gtM ? parseInt(gtM[1], 10) : null;
const expectedTotal = gtM ? parseEuropeanNumber(gtM[2]) : null;
console.log(`PDF summary: expectedQty=${expectedQty}, expectedTotal=${expectedTotal}`);

// ── STEP 1 — Parse (per-item slice approach) ─────────────────────────────────
const fieldRe = /(\d{7})(.+?)(?<=[a-z]) *(\d{4,5})(.+?)(\d{10})\s*([\d.,]+)\s*gr\s*([\d,. ]+?)\s*CHF\s*([\d.,]+)\s*CHF\s*([\d.,]+)\s*CHF/;

const itemStarts = [];
for (const c of itemsText.matchAll(/(?<!\d)(\d{7})(?!\d)/g)) {
  itemStarts.push({ itemNo: c[1], pos: c.index });
}

const missedRows = [];
const items = [];
for (let i = 0; i < itemStarts.length; i++) {
  const { itemNo, pos } = itemStarts[i];
  const end   = i + 1 < itemStarts.length ? itemStarts[i + 1].pos : itemsText.length;
  const slice = itemsText.slice(pos, end);
  const m = fieldRe.exec(slice);
  if (!m) {
    missedRows.push({ itemNo, context: slice.slice(0, 300).replace(/\s+/g, " ") });
    continue;
  }
  const { item, colour } = splitItemColour(m[2]);
  const country      = extractCountry(m[4]);
  const lineDiscount = parseEuropeanNumber(m[8]);
  const lineTotal    = parseEuropeanNumber(m[9]);
  let { qty, price } = parseQtyPrice(m[7], lineTotal, lineDiscount);
  if (Math.abs(round2(qty * price - lineDiscount) - lineTotal) > 0.02) {
    ({ qty, price } = bestQtyPrice(m[7], lineTotal, lineDiscount));
  }
  items.push({ itemNo: m[1], item, colour, qty, price, discount: lineDiscount, total: lineTotal, _combined: m[7] });
}

if (missedRows.length > 0) {
  console.log(`\n── ${missedRows.length} MISSED ROW(S) ──`);
  for (const r of missedRows) console.log(`  ✗ ${r.itemNo}: "${r.context}"`);
} else {
  console.log("\n── Missed rows: none ──");
}

// ── STEP 2 — Validate ────────────────────────────────────────────────────────
let parsedQty   = items.reduce((s, i) => s + i.qty, 0);
let parsedTotal = round2(items.reduce((s, i) => s + i.total, 0));
let totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
let qtyOk   = expectedQty  === null || parsedQty === expectedQty;
console.log(`\nStep 2 validation: qty ${parsedQty}/${expectedQty} ${qtyOk?"✓":"✗"}  total ${parsedTotal}/${expectedTotal} ${totalOk?"✓":"✗"}`);

// ── STEP 3 — Repair ──────────────────────────────────────────────────────────
const repairs = [];
if (!totalOk || !qtyOk) {
  console.log("\n── Repairing mismatches ──");
  for (const item of items) {
    const computed = round2(item.qty * item.price - item.discount);
    if (Math.abs(computed - item.total) > 0.02) {
      const fixed = bestQtyPrice(item._combined, item.total, item.discount);
      console.log(`  ↻ ${item.itemNo} "${item.item}" "${item.colour}" combined="${item._combined}" qty ${item.qty}→${fixed.qty} price ${item.price}→${fixed.price}`);
      repairs.push({ itemNo: item.itemNo, oldQty: item.qty, oldPrice: item.price, newQty: fixed.qty, newPrice: fixed.price });
      item.qty   = fixed.qty;
      item.price = fixed.price;
    }
  }

  // ── STEP 4 — Re-validate ─────────────────────────────────────────────────
  parsedQty   = items.reduce((s, i) => s + i.qty, 0);
  parsedTotal = round2(items.reduce((s, i) => s + i.total, 0));
  totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
  qtyOk   = expectedQty  === null || parsedQty === expectedQty;
}

if (repairs.length === 0) console.log("\n── Repairs: none needed ──");
else console.log(`\n── ${repairs.length} repair(s) applied ──`);

const valid = totalOk && qtyOk;
console.log(`\nFinal validation: qty ${parsedQty}/${expectedQty} ${qtyOk?"✓":"✗"}  total ${parsedTotal}/${expectedTotal} ${totalOk?"✓":"✗"}`);
console.log(`\n${valid ? "✅ SELF-VALIDATED — safe to push" : "❌ VALIDATION FAILED — do not push"}`);
if (!valid) {
  console.log(`  delta qty:   ${parsedQty - (expectedQty||0)}`);
  console.log(`  delta total: ${round2(parsedTotal - (expectedTotal||0))} CHF`);
}
