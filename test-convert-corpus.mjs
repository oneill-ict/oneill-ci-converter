// End-to-end test of the shipped handler over the whole training corpus.
//
// This replaces the parser copy that used to live inside test-batch.mjs. That
// copy had already drifted from production once — its boilerplate-stripping regex
// was missing two of the item-number formats the real parser had gained, so the
// batch test was passing while not exercising what shipped. A test that imports
// api/convert.js cannot drift.

import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { createRequire } from "node:module";
import handler from "./api/convert.js";
import { extractLines } from "./lib/invoice-rows.mjs";
import { readFooter, agreesWithFooter } from "./lib/invoice-footer.mjs";

const pdfParse = createRequire(import.meta.url)("pdf-parse");

// Cached formula results, read from the sheet XML. ExcelJS's own reader drops a result of
// 0 on load — the file correctly holds <v>0</v> — and a Total of 0,00 is exactly the case
// that matters here: eleven corpus invoices are 100% discounted.
async function cachedCells(buffer) {
  const xml = await (await JSZip.loadAsync(buffer)).file("xl/worksheets/sheet1.xml").async("string");
  const out = new Map();
  for (const c of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:<f>([^<]*)<\/f>)?(?:<v>([^<]*)<\/v>)?/g)) {
    out.set(c[1], c[3] ?? null);
  }
  return out;
}

// The corpus is not in the repository: these are real customer invoices with names
// and addresses on them. Point CI_CORPUS_DIR at the folder to run this locally; in
// CI the test skips rather than failing, so one command covers both.
const BASE = process.env.CI_CORPUS_DIR || "C:/Users/sjoerd.lier/Downloads/ci-training-files";
if (!fs.existsSync(BASE)) {
  console.log("SKIP: facturencorpus niet aanwezig");
  process.exit(0);
}
const find = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? find(p) : e.name.toLowerCase().endsWith(".pdf") ? [p] : [];
});

// Minimal stand-ins for Vercel's req/res. The handler only uses these members.
function mockRes() {
  const r = {
    statusCode: 200, headers: {}, body: null, buffer: null,
    setHeader(k, v) { r.headers[k.toLowerCase()] = String(v); return r; },
    status(c) { r.statusCode = c; return r; },
    json(o) { r.body = o; return r; },
    send(b) { r.buffer = b; return r; },
    end(b) { if (b) r.buffer = b; return r; },
  };
  return r;
}

const call = async (buf, filename, force = false) => {
  const res = mockRes();
  await handler({
    method: "POST",
    headers: { origin: "https://oneill-ci-converter-lemon.vercel.app" },
    body: { pdf: buf.toString("base64"), filename, force },
  }, res);
  return res;
};

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
let pass = 0, fail = 0, refused = 0, unchecked = 0;
const problems = [];
const t0 = Date.now();

for (const file of find(BASE).sort()) {
  const name = path.basename(file);
  const res  = await call(fs.readFileSync(file), name);
  const h    = res.headers;

  if (res.statusCode !== 200) {
    // A refusal is a valid outcome — no items, or a credit note. It has to be a
    // refusal, though, not a workbook full of wrong numbers.
    console.log(`  --   ${pad(name, 44)} HTTP ${res.statusCode}  ${res.body?.error ?? ""}`.slice(0, 150));
    refused++;
    continue;
  }

  const lineCount = +h["x-line-count"];
  const qty       = h["x-validation-qty"];
  const expQty    = h["x-validation-expected-qty"];
  const total     = h["x-validation-total"];
  const expTotal  = h["x-validation-expected-total"];
  const checked   = h["x-validation-checked"] === "1";

  // The workbook has to open. ExcelJS reading its own output back is the cheapest
  // check that a NaN or a bad formula did not make it unopenable.
  let sheetRows = null, wb = null;
  try {
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    sheetRows = wb.worksheets.reduce((s, w) => s + w.rowCount, 0);
  } catch (e) {
    problems.push(`${name}: workbook onleesbaar — ${e.message}`);
  }

  // The response headers the client depends on. test-screens.mjs renders the screens with a
  // currency handed to it directly, so it is silent about whether the header carrying that
  // currency is ever sent — and it was not: X-Currency sat in Access-Control-Expose-Headers
  // for a change before anything set it, so every screen fell back to "CHF" on invoices that
  // are mostly EUR. A test that renders a component proves nothing about its plumbing.
  const currencyHeader = h["x-currency"];
  const headerOk = /^(CHF|EUR|GBP|USD|CAD)$/.test(currencyHeader || "");

  const okQty   = !expQty   || qty   === expQty;
  const okTotal = !expTotal || Math.abs(+total - +expTotal) <= 0.5;

  // The workbook's own end total against the one the invoice prints. Nothing used to
  // compare these, and that is how fifteen invoice discounts — the largest EUR 62,750.50 —
  // and two shipping-cost lines vanished from delivered workbooks behind a green check.
  // Eleven of those invoices print "Total 0,00" because they are 100% discounted, and the
  // workbook was declaring the full goods value on a customs document.
  const footer = readFooter(await extractLines(fs.readFileSync(file), pdfParse));
  let endTotalOk = true, endDetail = "";
  if (wb && footer.grandTotal != null) {
    let totRow = null, hasShipping = false;
    for (const ws of wb.worksheets) {
      ws.eachRow((r, n) => {
        const label = String(r.getCell(1).value ?? "").trim();
        if (label === "Shipping costs") hasShipping = true;
        if (label === "Total") totRow = n;
      });
    }
    const cells = await cachedCells(res.buffer);
    const shown = totRow ? Number(cells.get(`K${totRow}`)) : NaN;
    // The allowance comes from the delivered workbook's own rows, not from a stand-in: the
    // printed unit price is rounded to two decimals while the line total is not, so the
    // permitted gap depends on how many lines that affects. Reading them back out of the
    // file also means this checks what was delivered rather than an intermediate value.
    const delivered = [];
    for (let n = 19; n <= 19 + lineCount - 1; n++) {
      const row = wb.worksheets[0].getRow(n);
      const val = (c) => { const v = row.getCell(c).value;
        return typeof v === "object" && v && "result" in v ? v.result : v; };
      delivered.push({ quantity: Number(val(8)), price: Number(val(9)),
                       discount: Number(val(10)) || 0, total: Number(val(11)) });
    }
    const allowance = agreesWithFooter(delivered, footer).allowance;
    const gapCents = Math.abs(Math.round(shown * 100) - Math.round(footer.grandTotal * 100));
    endTotalOk = Number.isFinite(shown) && gapCents <= allowance
              && (footer.shipping > 0) === hasShipping;
    endDetail = ` eind=${shown}/${footer.grandTotal}`;
  }
  const extra   = [
    h["x-unparsed-count"] ? `onleesbaar:${h["x-unparsed-count"]}` : "",
    h["x-uncertain-count"] ? `onzeker:${h["x-uncertain-count"]}` : "",
    h["x-noweight-count"] ? `zonder gewicht:${h["x-noweight-count"]}` : "",
  ].filter(Boolean).join(" ");

  if (!checked) unchecked++;
  if (okQty && okTotal && endTotalOk && headerOk && sheetRows) {
    console.log(`  ok   ${pad(name, 44)} ${pad(lineCount + " regels", 12)} qty=${qty}/${expQty} total=${total}/${expTotal}${endDetail} ${extra}`);
    pass++;
  } else {
    console.log(`  FAIL ${pad(name, 44)} ${pad(lineCount + " regels", 12)} qty=${qty}/${expQty} total=${total}/${expTotal} ${extra}`);
    problems.push(`${name}: qty ${qty}/${expQty}, total ${total}/${expTotal}${endDetail}` +
      `${endTotalOk ? "" : "  EINDTOTAAL WIJKT AF"}${headerOk ? "" : `  X-CURRENCY="${currencyHeader}"`}`);
    fail++;
  }
}

console.log("\n" + "=".repeat(74));
console.log(`geslaagd ${pass}   gefaald ${fail}   geweigerd ${refused}   niet te toetsen ${unchecked}`);
console.log(`${Math.round((Date.now() - t0) / 1000)}s voor het hele corpus`);
for (const p of problems) console.log("  " + p);
process.exit(fail || problems.length ? 1 : 0);
