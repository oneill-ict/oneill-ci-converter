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
import handler from "./api/convert.js";

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
  let sheetRows = null;
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    sheetRows = wb.worksheets.reduce((s, w) => s + w.rowCount, 0);
  } catch (e) {
    problems.push(`${name}: workbook onleesbaar — ${e.message}`);
  }

  const okQty   = !expQty   || qty   === expQty;
  const okTotal = !expTotal || Math.abs(+total - +expTotal) <= 0.5;
  const extra   = [
    h["x-unparsed-count"] ? `onleesbaar:${h["x-unparsed-count"]}` : "",
    h["x-uncertain-count"] ? `onzeker:${h["x-uncertain-count"]}` : "",
    h["x-noweight-count"] ? `zonder gewicht:${h["x-noweight-count"]}` : "",
  ].filter(Boolean).join(" ");

  if (!checked) unchecked++;
  if (okQty && okTotal && sheetRows) {
    console.log(`  ok   ${pad(name, 44)} ${pad(lineCount + " regels", 12)} qty=${qty}/${expQty} total=${total}/${expTotal} ${extra}`);
    pass++;
  } else {
    console.log(`  FAIL ${pad(name, 44)} ${pad(lineCount + " regels", 12)} qty=${qty}/${expQty} total=${total}/${expTotal} ${extra}`);
    problems.push(`${name}: qty ${qty}/${expQty}, total ${total}/${expTotal}`);
    fail++;
  }
}

console.log("\n" + "=".repeat(74));
console.log(`geslaagd ${pass}   gefaald ${fail}   geweigerd ${refused}   niet te toetsen ${unchecked}`);
console.log(`${Math.round((Date.now() - t0) / 1000)}s voor het hele corpus`);
for (const p of problems) console.log("  " + p);
process.exit(fail || problems.length ? 1 : 0);
