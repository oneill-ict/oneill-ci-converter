// Self-validation test against real PDF — two-step parser
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
let flatText = data.text.replace(/\n/g, " ");
flatText = flatText.replace(/(?<!\d)(\d{2,6}) (\d{1,6})(?!\d)/g, (m, a, b) => {
  const combined = a + b;
  return combined.length === 7 ? combined : m;
});
const itemsStart = flatText.indexOf("DiscountTotal");
const flatLower  = flatText.toLowerCase();
const itemsEnd   = flatLower.lastIndexOf("goods total");
const itemsText  = itemsStart >= 0 && itemsEnd > itemsStart
  ? flatText.slice(itemsStart, itemsEnd)
  : flatText;

let lastGtM = null;
for (const m of flatText.matchAll(/Goods total\s*(\d+)\s+([\d.,]+)\s*CHF/gi)) lastGtM = m;
const expectedQty   = lastGtM ? parseInt(lastGtM[1], 10) : null;
const expectedTotal = lastGtM ? parseEuropeanNumber(lastGtM[2]) : null;
console.log(`PDF summary: expectedQty=${expectedQty}, expectedTotal=${expectedTotal}`);

// ── STEP 1 — Split into per-item blocks ──────────────────────────────────────
const splitRe = /(?<!\d)(?=(?:\d{7}(?!\d{3})|N\d{5}(?!\d)))/g;
const blocks  = itemsText.split(splitRe).filter(b => b.trim());
console.log(`\nBlocks found: ${blocks.length}`);

// ── STEP 2 — Parse each block ────────────────────────────────────────────────
const missedRows = [];
const items = [];

for (const block of blocks) {
  const itemNoM = /(?<!\d)(\d{7}(?!\d{3})|N\d{5}(?!\d))/.exec(block);
  if (!itemNoM) continue;
  const itemNo    = itemNoM[1];
  const itemNoEnd = itemNoM.index + itemNo.length;

  const chfAll = [...block.matchAll(/([\d., ]+?)\s*CHF/g)];
  if (chfAll.length < 3) {
    missedRows.push({ itemNo, reason: `${chfAll.length} CHF values`, context: block.slice(0, 200).replace(/\s+/g, " ") });
    continue;
  }
  const last3        = chfAll.slice(-3);
  const combined     = last3[0][1].trim();
  const lineDiscount = parseEuropeanNumber(last3[1][1].trim());
  const lineTotal    = parseEuropeanNumber(last3[2][1].trim());

  const tariffGrM = /(\d{10})(\d+[.,]\d+)\s*gr/.exec(block);
  if (!tariffGrM) {
    missedRows.push({ itemNo, reason: "no tariff+gr", context: block.slice(0, 200).replace(/\s+/g, " ") });
    continue;
  }
  const tariffNo  = tariffGrM[1];
  const tariffPos = tariffGrM.index;
  const grossWeight = parseEuropeanNumber(tariffGrM[2]);
  const midText   = block.slice(itemNoEnd, tariffPos);

  const colourNoM = /(?<=[a-z]|(?<=\s)[A-Z]) *(\d{4,6})(?!\d)/.exec(midText);
  const colourNo  = colourNoM ? colourNoM[1] : "";

  const afterColourNo = colourNoM
    ? midText.slice(colourNoM.index + colourNoM[0].length)
    : midText;
  const country = extractCountry(afterColourNo.trim());

  const namePart = colourNoM
    ? midText.slice(0, colourNoM.index).trim()
    : midText.trim();
  const { item, colour } = splitItemColour(namePart);

  let { qty, price } = parseQtyPrice(combined, lineTotal, lineDiscount);
  if (Math.abs(round2(qty * price - lineDiscount) - lineTotal) > 0.01) {
    ({ qty, price } = bestQtyPrice(combined, lineTotal, lineDiscount));
  }

  items.push({ itemNo, item, colour, colourNo, country, tariffNo,
    qty, price, discount: lineDiscount, total: lineTotal, _combined: combined });
}

// ── Diagnostics ──────────────────────────────────────────────────────────────
if (missedRows.length > 0) {
  console.log(`\n── ${missedRows.length} MISSED ROW(S) ──`);
  for (const r of missedRows) console.log(`  ✗ ${r.itemNo} (${r.reason}): "${r.context}"`);
} else {
  console.log("\n── Missed rows: none ──");
}

console.log("\n── Rows where |qty×price - total| > 0.01 ──");
let suspectCount = 0;
for (const it of items) {
  const computed = round2(it.qty * it.price - it.discount);
  const diff = Math.abs(computed - it.total);
  if (diff > 0.01) {
    suspectCount++;
    console.log(`  ✗ ${it.itemNo} "${it.item}" "${it.colour}" combined="${it._combined}" qty=${it.qty} price=${it.price} disc=${it.discount} → computed=${computed} total=${it.total} diff=${round2(diff)}`);
  }
}
if (suspectCount === 0) console.log("  (none)");

console.log("\n── Rows with qty > 1 ──");
let bigQtyCount = 0;
for (const it of items) {
  if (it.qty > 1) {
    bigQtyCount++;
    const computed = round2(it.qty * it.price - it.discount);
    const ok = Math.abs(computed - it.total) < 0.01;
    console.log(`  ${ok?"✓":"✗"} ${it.itemNo} "${it.item}" "${it.colour}" combined="${it._combined}" qty=${it.qty} price=${it.price} total=${it.total}`);
  }
}
if (bigQtyCount === 0) console.log("  (none)");

// ── STEP 3 — Validate ────────────────────────────────────────────────────────
let parsedQty   = items.reduce((s, i) => s + i.qty, 0);
let parsedTotal = round2(items.reduce((s, i) => s + i.total, 0));
let totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
let qtyOk   = expectedQty  === null || parsedQty === expectedQty;
console.log(`\nStep 3 validation: qty ${parsedQty}/${expectedQty} ${qtyOk?"✓":"✗"}  total ${parsedTotal}/${expectedTotal} ${totalOk?"✓":"✗"}`);

// ── STEP 4 — Repair ──────────────────────────────────────────────────────────
const repairs = [];
if (!totalOk || !qtyOk) {
  console.log("\n── Repairing mismatches ──");
  for (const item of items) {
    const computed = round2(item.qty * item.price - item.discount);
    if (Math.abs(computed - item.total) > 0.01) {
      const fixed = bestQtyPrice(item._combined, item.total, item.discount);
      console.log(`  ↻ ${item.itemNo} combined="${item._combined}" qty ${item.qty}→${fixed.qty} price ${item.price}→${fixed.price}`);
      repairs.push(item.itemNo);
      item.qty   = fixed.qty;
      item.price = fixed.price;
    }
  }
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
  console.log("\n── Top-5 largest discrepancies after repair ──");
  const diffs = items.map(it => ({
    itemNo: it.itemNo, item: it.item, colour: it.colour,
    combined: it._combined, qty: it.qty, price: it.price,
    total: it.total, discount: it.discount,
    diff: Math.abs(round2(it.qty * it.price - it.discount) - it.total),
  })).sort((a, b) => b.diff - a.diff).slice(0, 5);
  for (const d of diffs) {
    console.log(`  ${d.itemNo} "${d.item}" "${d.colour}" combined="${d.combined}" qty=${d.qty} price=${d.price} disc=${d.discount} total=${d.total} diff=${d.diff}`);
  }
}
