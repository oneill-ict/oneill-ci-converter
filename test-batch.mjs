// Batch test: run all training PDFs through the current parser.
// Run: node test-batch.mjs
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const _itemDbArr = JSON.parse(readFileSync(join(__dirname, "api", "item-db.json"), "utf8"));
const ITEM_DB     = new Set(_itemDbArr);
const ITEM_PREFIX = new Set();
for (const code of ITEM_DB) {
  for (let i = 1; i <= code.length; i++) ITEM_PREFIX.add(code.slice(0, i));
}

function findDbItemAt(text, pos, minLen = 4) {
  let last = null;
  for (let end = pos + minLen; end <= Math.min(pos + 18, text.length); end++) {
    const cand = text.slice(pos, end);
    if (!ITEM_PREFIX.has(cand)) break;
    if (ITEM_DB.has(cand)) last = cand;
  }
  return last;
}

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
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0, discMult: 1 };
  const intPart = s.slice(0, commaIdx);
  const decPart = s.slice(commaIdx + 1).trim();
  const expectedProd = round2(totalCHF + discountCHF);
  // Pass 1: line-discount format
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceInt = intPart.slice(qLen).replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price)) continue;
    if (Math.abs(round2(qty * price) - expectedProd) < 0.02) return { qty, price, discMult: 1 };
  }
  // Pass 2: per-unit discount format
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
  const s = combined.trim();
  const commaIdx = s.indexOf(",");
  // Must report the worst diff: nothing was split, and the price is forced to 0.
  if (commaIdx < 0) return { qty: parseInt(s, 10), price: 0, discMult: 1, diff: Infinity };
  const intPart = s.slice(0, commaIdx);
  const decPart = s.slice(commaIdx + 1).trim();
  const target  = round2(totalCHF + discountCHF);
  let bestDiff = Infinity, best = null;
  for (let qLen = 1; qLen < intPart.length; qLen++) {
    const priceInt = intPart.slice(qLen).replace(/\./g, "").trim();
    if (!priceInt || priceInt[0] === "0") continue;
    const qty   = parseInt(intPart.slice(0, qLen), 10);
    const price = parseFloat(`${priceInt}.${decPart}`);
    if (isNaN(qty) || isNaN(price) || qty === 0) continue;
    const diff1 = Math.abs(round2(qty * price) - target);
    if (diff1 < bestDiff) { bestDiff = diff1; best = { qty, price, discMult: 1 }; }
    const diff2 = Math.abs(totalCHF / qty - (price - discountCHF)) * qty;
    if (diff2 < bestDiff) { bestDiff = diff2; best = { qty, price, discMult: qty }; }
  }
  if (best) return { ...best, diff: bestDiff };
  return { qty: parseInt(intPart, 10), price: parseFloat(`0.${decPart}`), discMult: 1, diff: Infinity };
}

const QTY_SPLIT_TOLERANCE = 0.02;

function extractCountry(groupCountry) {
  const trimmed = groupCountry.trim();
  const idx = trimmed.search(/(?<=[a-z])(?=[A-Z])/);
  if (idx > 0) return trimmed.slice(idx).trim();
  const words = trimmed.split(/\s+/);
  return words[words.length - 1] || trimmed;
}

// Mirrors readGoodsTotal() in api/convert.js — keep both in sync.
function readGoodsTotal(flatText) {
  const CUR = /(?:CHF|EUR|GBP|USD|CAD)/.source;

  let spaced = null;
  for (const m of flatText.matchAll(new RegExp(`Goods total\\s*(\\d+)\\s+([\\d.,]+)\\s*${CUR}`, "gi"))) spaced = m;
  if (spaced) return { qty: parseInt(spaced[1], 10), total: parseEuropeanNumber(spaced[2]) };

  let glued = null;
  for (const m of flatText.matchAll(new RegExp(`Goods total([\\d.,]+)\\s*${CUR}`, "gi"))) glued = m;
  if (!glued) return { qty: null, total: null };

  const tail  = flatText.slice(glued.index);
  const subM  = new RegExp(`Subtotal([\\d.,]+)\\s*${CUR}`, "i").exec(tail);
  const discM = new RegExp(`Discount([\\d.,]+)\\s*${CUR}`, "i").exec(tail);
  if (!subM) return { qty: null, total: null };
  const target = round2(parseEuropeanNumber(subM[1]) + (discM ? parseEuropeanNumber(discM[1]) : 0));

  const run = glued[1];
  for (let i = 1; i < run.length; i++) {
    const qStr = run.slice(0, i), aStr = run.slice(i);
    if (!/^\d+$/.test(qStr)) break;
    if (!/^(0|[1-9]\d{0,2})(\.\d{3})*,\d{2}$/.test(aStr)) continue;
    if (Math.abs(parseEuropeanNumber(aStr) - target) < 0.005) {
      return { qty: parseInt(qStr, 10), total: parseEuropeanNumber(aStr) };
    }
  }
  return { qty: null, total: target };
}

function parseInvoiceText(text) {
  const currencyM = /\b(CHF|EUR|GBP|USD|CAD)\b/.exec(text);
  const currency  = currencyM ? currencyM[1] : "CHF";

  let flatText = text.replace(/\n/g, " ");
  flatText = flatText.replace(/(?<!\d)(\d{2,6}) (\d{1,6})(?!\d)/g, (m, a, b) => {
    const combined = a + b;
    return combined.length === 7 ? combined : m;
  });
  flatText = flatText.replace(/Bei Waren[\s\S]*?(?=\d{4}[A-Z]|\d{7,8}|N\d{5,7})/g, '');
  flatText = flatText.replace(/(CHF|EUR|GBP) {2,}/g, '$1 ');

  const itemsStart = flatText.indexOf("DiscountTotal");
  const flatLower  = flatText.toLowerCase();
  let itemsEnd     = flatLower.indexOf("subtotal tariff no.");
  if (itemsEnd < 0) itemsEnd = flatLower.lastIndexOf("goods total");
  const lastGoodsTotal = flatLower.lastIndexOf("goods total", itemsEnd < 0 ? undefined : itemsEnd);
  if (lastGoodsTotal > itemsStart) itemsEnd = lastGoodsTotal;
  const itemsText  = itemsStart >= 0 && itemsEnd > itemsStart
    ? flatText.slice(itemsStart, itemsEnd)
    : itemsStart >= 0 ? flatText.slice(itemsStart) : flatText;

  const { qty: expectedQty, total: expectedTotal } = readGoodsTotal(flatText);

  const splitRe = /(?<![\dN])(?=\d{7,8}(?!\d))|(?<!\d)(?=N\d{5,7}(?!\d))|(?<=(?:CHF|EUR|GBP|USD|CAD) )(?=\d{4}[A-Z])|(?<=(?:CHF|EUR|GBP|USD|CAD) )(?=ONS[A-Z])/g;
  const blocks  = itemsText.split(splitRe).filter(b => b.trim());

  const missedRows = [];
  const items      = [];

  for (let _bi = 0; _bi < blocks.length; _bi++) {
    const block = blocks[_bi];
    const itemNoM = /(?<![\dN])(\d{7,8})(?!\d)|(?<!\d)(N\d{5,7})(?!\d)|^(\d{4}[A-Z])|^(ONS[A-Z]+)|^(\d{4})(?= [A-Z])/.exec(block);
    let itemNo, itemNoEnd;
    if (itemNoM) {
      itemNo    = itemNoM[1] || itemNoM[2] || itemNoM[3] || itemNoM[4] || itemNoM[5];
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
        const looksLikeRow = /\d{10}/.test(block) && /(?:CHF|EUR|GBP|USD|CAD)/.test(block);
        if (looksLikeRow) {
          missedRows.push({ itemNo: "???", reason: "no item number in block", context: block.slice(0, 150).replace(/\s+/g, " ") });
        }
        continue;
      }
    }

    const tariffGrM = /(\d{10})(\d[\d.]*,\d+)\s*gr/.exec(block);
    let tariffNo, tariffPos, tariffEnd, grossWeight = null;
    if (tariffGrM) {
      tariffNo    = tariffGrM[1];
      tariffPos   = tariffGrM.index;
      tariffEnd   = tariffGrM.index + tariffGrM[0].length;
      grossWeight = parseEuropeanNumber(tariffGrM[2]);
    } else {
      const bareM = /(\d{10})(?=\d)/.exec(block.slice(itemNoEnd));
      if (bareM) {
        tariffNo  = bareM[1];
        tariffPos = itemNoEnd + bareM.index;
        tariffEnd = tariffPos + bareM[0].length;
      }
    }
    if (!tariffNo) {
      missedRows.push({ itemNo, reason: "no tariff number", context: block.slice(0, 150).replace(/\s+/g, " ") });
      continue;
    }
    const afterTariffText = block.slice(tariffEnd);
    const chfAfterTariff  = [...afterTariffText.matchAll(/([\d., ]+?)\s*(?:CHF|EUR|GBP|USD|CAD)/g)];
    if (chfAfterTariff.length < 3) {
      missedRows.push({ itemNo, reason: `${chfAfterTariff.length} currency values after tariff`, context: block.slice(0, 150).replace(/\s+/g, " ") });
      continue;
    }
    const first3       = chfAfterTariff.slice(0, 3);
    const combined     = first3[0][1].trim();
    const lineDiscount = parseEuropeanNumber(first3[1][1].trim());
    const lineTotal    = parseEuropeanNumber(first3[2][1].trim());

    const _tariffBase   = tariffEnd;
    const _firstItemEnd = _tariffBase + first3[2].index + first3[2][0].length;
    const _embTail      = block.slice(_firstItemEnd).trimStart();
    if (_embTail.length > 20 && /\d{10}/.test(_embTail)) {
      blocks.splice(_bi + 1, 0, _embTail);
    }

    const midText    = block.slice(itemNoEnd, tariffPos);
    const colourNoM  = /(?<=[a-z]|(?<=\s)[A-Z]) *(\d{4,6})(?!\d)/.exec(midText);
    const colourNo   = colourNoM ? colourNoM[1] : "";

    const afterColourNo = colourNoM
      ? midText.slice(colourNoM.index + colourNoM[0].length)
      : midText;
    const country = extractCountry(afterColourNo.trim());

    const namePart = colourNoM ? midText.slice(0, colourNoM.index).trim() : midText.trim();
    const { item, colour } = splitItemColour(namePart);

    let { qty, price, discMult } = parseQtyPrice(combined, lineTotal, lineDiscount);
    let qtyUncertain = false;
    if (Math.abs(round2(qty * price - lineDiscount * discMult) - lineTotal) > 0.01) {
      const guess = bestQtyPrice(combined, lineTotal, lineDiscount);
      ({ qty, price, discMult } = guess);
      qtyUncertain = guess.diff > QTY_SPLIT_TOLERANCE;
    }
    const storedDiscount = round2(lineDiscount * discMult);

    items.push({ itemNo, item, colour, colourNo, country, tariffNo, grossWeight,
      quantity: qty, pricePerPiece: price, discount: storedDiscount, total: lineTotal,
      _combined: combined, _origDiscount: lineDiscount, _qtyUncertain: qtyUncertain });
  }

  let parsedQty   = items.reduce((s, i) => s + i.quantity, 0);
  let parsedTotal = round2(items.reduce((s, i) => s + i.total, 0));
  let totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
  let qtyOk   = expectedQty  === null || parsedQty === expectedQty;

  const repairs = [];
  if (!totalOk || !qtyOk) {
    for (const item of items) {
      const computed = round2(item.quantity * item.pricePerPiece - item.discount);
      if (Math.abs(computed - item.total) > 0.01) {
        const fixed = bestQtyPrice(item._combined, item.total, item._origDiscount ?? item.discount);
        repairs.push(item.itemNo);
        item.quantity      = fixed.qty;
        item.pricePerPiece = fixed.price;
        item.discount      = round2((item._origDiscount ?? item.discount) * fixed.discMult);
      }
    }
    parsedQty   = items.reduce((s, i) => s + i.quantity, 0);
    parsedTotal = round2(items.reduce((s, i) => s + i.total, 0));
    totalOk = expectedTotal === null || Math.abs(parsedTotal - expectedTotal) < 0.10;
    qtyOk   = expectedQty  === null || parsedQty === expectedQty;
  }

  // What the Excel will actually contain — mirrors STEP 5 in api/convert.js.
  for (const it of items) {
    it.computedTotal = round2(it.quantity * it.pricePerPiece - it.discount);
  }
  const excelTotal = round2(items.reduce((s, i) => s + i.computedTotal, 0));
  const driftLines = items
    .filter(i => Math.abs(i.computedTotal - i.total) > 0.005)
    .map(i => i.itemNo);
  const excelOk = expectedTotal === null || Math.abs(excelTotal - expectedTotal) < 0.10;

  return {
    currency, items, missedRows,
    expectedQty, expectedTotal, parsedQty, parsedTotal,
    totalOk, qtyOk, excelOk, excelTotal, driftLines,
    noWeightLines: items.filter(i => i.grossWeight == null).map(i => i.itemNo),
    valid: totalOk && qtyOk && excelOk,
    repairs,
    uncertainLines: items.filter(i => i._qtyUncertain).map(i => i.itemNo),
  };
}

// ── Find all PDFs ─────────────────────────────────────────────────────────────

function findPdfs(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...findPdfs(full));
    else if (entry.toLowerCase().endsWith(".pdf")) results.push(full);
  }
  return results;
}

const BASE = "C:\\Users\\sjoerd.lier\\Downloads\\ci-training-files";
const pdfs = findPdfs(BASE).sort();

console.log(`\nBatch testing ${pdfs.length} PDFs\n${"─".repeat(80)}`);

const results = { pass: [], fail: [], skip: [], error: [] };
// Invoices whose grand total could not be read are validated against nothing —
// they pass by default. Track them so that coverage can never silently regress.
const unchecked = [];

for (const pdfPath of pdfs) {
  const label = pdfPath.replace(BASE + "\\", "").replace(/\\/g, "/");
  try {
    const buf  = readFileSync(pdfPath);
    const data = await pdfParse(buf);
    const r    = parseInvoiceText(data.text);

    if (r.items.length === 0) {
      console.log(`  ⬜ SKIP  ${label}  (no CI items found)`);
      results.skip.push(label);
      continue;
    }

    if (r.expectedQty == null || r.expectedTotal == null) unchecked.push(label);

    if (r.valid) {
      const unparsed = r.missedRows.length > 0 ? ` [${r.missedRows.length} missed]` : "";
      console.log(`  ✅ PASS  ${label}  qty=${r.parsedQty}/${r.expectedQty} total=${r.parsedTotal}/${r.expectedTotal} ${r.currency}${unparsed}`);
      // Totals reconcile, but a block was still unreadable — worth seeing, since
      // it is the shape a future silent gap would take.
      for (const mr of r.missedRows) {
        console.log(`         ↳ ${mr.itemNo}: ${mr.reason} — "${mr.context.slice(0, 90)}"`);
      }
      // Totals reconcile but a quantity could not be derived — the number in
      // the export is a guess, and quantity is a customs-declared field.
      if (r.uncertainLines.length > 0) {
        console.log(`         ⚠ guessed quantity on ${r.uncertainLines.length} line(s): ${r.uncertainLines.slice(0, 8).join(", ")}`);
      }
      // Excel total agrees with the invoice, but individual lines may still
      // recompute to a different figure than the PDF states.
      if (r.driftLines.length > 0) {
        console.log(`         ⚠ excel total ${r.excelTotal} vs stated ${r.parsedTotal}; drifting line(s): ${r.driftLines.slice(0, 8).join(", ")}`);
      }
      // Gross weight is a customs-declared field; a blank must be visible.
      if (r.noWeightLines.length > 0) {
        console.log(`         ⚠ no gross weight on ${r.noWeightLines.length} line(s): ${r.noWeightLines.slice(0, 6).join(", ")}`);
      }
      results.pass.push(label);
    } else {
      const dQty   = r.expectedQty   != null ? ` Δqty=${r.parsedQty - r.expectedQty}` : "";
      const dTotal = r.expectedTotal != null ? ` Δtotal=${round2(r.parsedTotal - r.expectedTotal)}` : "";
      const why = [!r.qtyOk && "qty", !r.totalOk && "total", !r.excelOk && "EXCEL"].filter(Boolean).join("+");
      console.log(`  ❌ FAIL  ${label}  [${why}]  qty=${r.parsedQty}/${r.expectedQty}${dQty} total=${r.parsedTotal}/${r.expectedTotal}${dTotal} ${r.currency}`);
      if (!r.excelOk) {
        console.log(`         excel total ${r.excelTotal} vs invoice ${r.expectedTotal}  (drifting lines: ${r.driftLines.join(", ")})`);
      }
      if (r.missedRows.length > 0) {
        for (const mr of r.missedRows.slice(0, 5)) {
          console.log(`         missed ${mr.itemNo}: ${mr.reason} — "${mr.context.slice(0, 100)}"`);
        }
      }
      results.fail.push({ label, r });
    }
  } catch (e) {
    console.log(`  💥 ERR   ${label}  ${e.message.slice(0, 80)}`);
    results.error.push({ label, err: e.message });
  }
}

console.log(`\n${"─".repeat(80)}`);
console.log(`PASS: ${results.pass.length}  FAIL: ${results.fail.length}  SKIP: ${results.skip.length}  ERROR: ${results.error.length}`);

const checkedCount = results.pass.length + results.fail.length - unchecked.length;
console.log(`VALIDATED: ${checkedCount}/${results.pass.length + results.fail.length} parsed invoices had a readable grand total`);
if (unchecked.length > 0) {
  console.log(`\n⚠️  ${unchecked.length} invoice(s) validated against NOTHING — a dropped line here goes unnoticed:`);
  for (const label of unchecked) console.log(`     ${label}`);
}

if (results.fail.length > 0) {
  console.log(`\n── Failures (detail) ──`);
  for (const { label, r } of results.fail) {
    console.log(`\n  ${label}`);
    console.log(`    qty:   ${r.parsedQty} / ${r.expectedQty}`);
    console.log(`    total: ${r.parsedTotal} / ${r.expectedTotal} ${r.currency}`);
    if (r.missedRows.length > 0) {
      console.log(`    missed rows (${r.missedRows.length}):`);
      for (const mr of r.missedRows) {
        console.log(`      - ${mr.itemNo}: ${mr.reason}`);
        console.log(`        "${mr.context.slice(0, 120)}"`);
      }
    }
  }
}
