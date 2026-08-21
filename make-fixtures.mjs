// Builds the committed test fixtures from the invoice corpus.
//
// The automatic tests could not read a single real invoice: the corpus is 45 actual
// customer invoices and does not belong in a repository, so a parsing regression was
// only catchable on the one laptop that has the folder. A fixture is the positioned
// text runs of a real invoice, which is exactly what the reader consumes, so the
// tests exercise the real thing without the PDFs.
//
// No anonymising is involved, and that is deliberate. The item table holds no customer
// data — item number, product name, colour, country of manufacture, tariff number,
// weight, quantity, price, discount, total — so a fixture that contains only table
// rows has nothing to scrub, and nothing to forget to scrub.
//
// Which means the filter is an allowlist, not a blocklist: a line is kept only if its
// shape says it is table content. Unknown content is excluded by default. The first
// attempt did the opposite — drop the address block above the "COMMERCIAL INVOICE"
// title, keep the rest — and the leak check immediately found what that misses: the
// last page carries the customs agent's address, a VAT number and a ZAZ customs
// account number in its footer. A blocklist only stops what you thought of.
//
// The tariff subtotal rows are kept on purpose. They hold 10-digit tariff numbers and
// are the lines most likely to be mistaken for item rows, so a fixture without them
// would not test the one confusion that matters. Prose and boilerplate are not kept;
// that the reader ignores prose is proved by a synthetic test instead, where the text
// is mine rather than a customer's.
//
// The check at the end is not a formality. It reads the customer name and address out
// of the invoice with the same regex production uses, and refuses to write the fixture
// if any of it survives. My judgement about which lines are safe is worth less than a
// test of it.
//
// Run: node make-fixtures.mjs      (needs the corpus; see CI_CORPUS_DIR)

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { groupIntoLines, readItemRows } from "./lib/invoice-rows.mjs";
import { readFooter } from "./lib/invoice-footer.mjs";

const pdfParse = createRequire(import.meta.url)("pdf-parse");
const BASE = process.env.CI_CORPUS_DIR || "C:/Users/sjoerd.lier/Downloads/ci-training-files";
const OUT  = "test/fixtures";

// Chosen for what they cover, not for being representative — each one is the only
// invoice in the corpus exercising something, or the smallest that does.
const WANTED = [
  ["CI 1261915.pdf",                          "eur-three-rows",
   "the smallest complete invoice: 3 rows, one page, EUR"],
  ["CI 1094482.pdf",                          "weightless-template",
   "the only template that states gross weight in the header instead of per line"],
  ["CI Bens Surf Clinic 1377693_1381009.pdf", "per-piece-discounts",
   "the only invoice discounting per piece rather than per line"],
  ["CI Truck 5 Sportisimo.pdf",               "large-quantities",
   "2500 pieces on a line and a six-figure total"],
  ["CI 1146402.pdf",                          "n-prefix-item-numbers",
   "two pages, N-prefixed item numbers, 291 pieces"],
  ["CI CH B2C 03-08-26.pdf",                  "ch-b2c-172-rows",
   "172 rows over five pages in CHF — the invoice behind the 227-versus-223 report"],
];

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

if (!fs.existsSync(BASE)) {
  console.error(`Corpus niet gevonden op ${BASE}. Zet CI_CORPUS_DIR.`);
  process.exit(1);
}
const all = walk(BASE);
const round = (n) => Math.round(n * 100) / 100;

// The allowlist. Three shapes of line are table content and nothing else is kept.
function isTableLine(line) {
  const runs = line.runs;
  const texts = runs.map(r => r.text);
  // The column header, which is what tells the reader what each column means.
  if (texts.some(t => /^Item No\.?$/i.test(t))) return true;
  // An item row: many cells, one of them a bare 10-digit tariff number.
  if (runs.length >= 8 && texts.some(t => /^\d{10}$/.test(t))) return true;
  // A tariff subtotal row: a 10-digit tariff first, then two to four figures. Kept
  // because these are the lines most easily mistaken for item rows.
  if (runs.length >= 2 && runs.length <= 5 && /^\d{10}$/.test(texts[0])) return true;
  return false;
}

// ── Raw runs, for testing the line grouping itself ─────────────────────────
// The fixtures above store the *output* of extractLines, so a change to how runs are
// grouped into lines is invisible to them — proved by accident: the grouping rule changed
// from a fixed 2-point bucket to one relative to text height, all 96 fixture assertions
// stayed green, and only regenerating the files showed one had moved. So one fixture also
// records the runs before grouping.
//
// The item table goes in verbatim; it holds no customer data. The invoice-level block
// does, so its values are replaced while the labels, positions and text heights stay
// exactly as measured — those are what the grouping is judged on, and the values are not.
// This is the one place in this repository where anonymising is the right tool, because
// here the geometry is the point and the content is not.
const HEADER_LABELS_KEEP = new Set([
  "Date:", "Order number:", "Delivery terms:", "Number of boxes:", "Gross weight:",
  "Document No.:", "Transport:", "Transport no.:", "Shipment Numbers:", "Comments:",
  "VAT number:", "Delivery address", "Billing address", "COMMERCIAL INVOICE",
]);

// A stand-in of the same shape, so nothing about the layout changes.
function scrub(text) {
  if (HEADER_LABELS_KEEP.has(text.trim())) return text;
  return text
    .replace(/\d/g, "4")
    .replace(/[A-Z]/g, "X")
    .replace(/[a-z]/g, "x");
}

function rawFixture(runs, tableFromY) {
  return runs.map(r => {
    const inTable = r.y <= tableFromY;
    return {
      page: r.page, x: round(r.x), y: round(r.y), h: round(r.h),
      text: inTable ? r.text : scrub(r.text),
    };
  });
}

for (const [file, name, describes] of WANTED) {
  const full = all.find(p => p.endsWith(file));
  if (!full) { console.error(`  ONTBREEKT  ${file}`); process.exitCode = 1; continue; }

  const buf   = fs.readFileSync(full);
  // Collected here rather than taken from extractLines, so the raw runs and the grouped
  // lines provably come from the same read.
  const runs = [];
  await pdfParse(buf, { max: 100, pagerender: async (pd) => {
    const tc = await pd.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: true });
    for (const it of tc.items) {
      const t = (it.str || "").trim();
      if (!t) continue;
      const [, , , d, x, y] = it.transform;
      runs.push({ page: pd.pageIndex + 1, x, y, h: Number(it.height) || Math.abs(d) || 1, text: t });
    }
    return "";
  }});
  const lines = groupIntoLines(runs);
  const text  = (await pdfParse(buf, { max: 100 })).text;

  const kept = lines.filter(isTableLine).map(l => ({
    page: l.page,
    y: round(l.y),
    runs: l.runs.map(r => ({ x: round(r.x), text: r.text })),
  }));

  // Refuse to write anything that still carries the customer.
  const billing = /Billing address\s+([\s\S]+?)O'Neill Europe B\.V\./i.exec(text);
  const secrets = [
    ...(billing ? billing[1].trim().split(/\n/).map(s => s.trim()).filter(s => s.length > 3) : []),
    ...[/Document No\.:\s*(\S+)/, /Order number:\s*([\d,]+)/, /Transport no\.:\s*(\S+)/]
      .map(re => (re.exec(text) || [])[1]).filter(Boolean),
  ];
  const haystack = kept.flatMap(l => l.runs.map(r => r.text)).join("\n");
  const hits = secrets.filter(s => haystack.includes(s));

  // A hit is only a leak if the string identifies someone. On the B2C invoices the
  // billing name is "O'Neill", which also occurs in a colour ("Black/Purple O'Neill
  // Stripe") — that is product vocabulary, not the customer. Rather than raising a
  // length threshold and hoping, test it: a string that appears in the product-name or
  // colour column of an item row is vocabulary. Everything else is a leak.
  const vocabulary = new Set();
  for (const line of kept) {
    if (!(line.runs.length >= 8 && line.runs.some(r => /^\d{10}$/.test(r.text)))) continue;
    for (const r of line.runs.slice(1, 3)) vocabulary.add(r.text);   // name, colour
  }
  const leaked  = hits.filter(h => ![...vocabulary].some(v => v.includes(h)));
  const allowed = hits.filter(h => !leaked.includes(h));
  if (allowed.length) {
    console.log(`      ${JSON.stringify(allowed)} komt ook in een product- of kleurnaam voor — woordenschat, geen identiteit`);
  }

  if (leaked.length) {
    console.error(`  LEKT  ${file} — nog aanwezig: ${JSON.stringify(leaked)}`);
    process.exitCode = 1;
    continue;
  }

  const { rows, columns, discountPerPiece, currency, skipped } = readItemRows(kept);
  // From the full document, not from `kept` — the summary block is not table content, so
  // the allowlist excludes it. The footer figures are the oracle the fixture records.
  const footer = readFooter(lines);

  const fixture = {
    name, describes,
    builtBy: "make-fixtures.mjs — do not hand-edit; the source invoice is not in this repo",
    kept: "only the column header, the item rows and the tariff subtotal rows. Everything else — addresses, document and order numbers, the customs agent block, VAT and ZAZ account numbers, boilerplate — is excluded by shape, not by a list of things to remove.",
    // The invoice's own footer is the oracle. Everything else here is what the reader
    // must keep producing.
    expected: {
      rows: rows.length,
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      total: round(rows.reduce((s, r) => s + r.total, 0)),
      currency,
      footerQuantity: footer.qty,
      footerTotal: footer.total,
      discountPerPiece,
      rowsWithoutWeight: rows.filter(r => r.weight == null).length,
      rowsWithoutPrice: rows.filter(r => r.price == null).length,
      rowsWithDiscount: rows.filter(r => r.discount !== 0).length,
      columnsFound: columns.length,
      columnsNamed: columns.filter(c => c.key).length,
      skipped: skipped.length,
      pages: Math.max(...kept.map(l => l.page)),
    },
    lines: kept,
  };

  // One is enough, and it has to be the invoice whose header renders at text height
  // 0.349 — the case a fixed tolerance got wrong.
  if (name === "large-quantities") {
    const titleY = Math.max(...lines
      .filter(l => l.runs.some(r => /COMMERCIAL INVOICE/i.test(r.text)))
      .map(l => l.y), -Infinity);
    const raw = {
      name: `${name}-raw-runs`,
      describes: "the runs before grouping, from the invoice whose header block renders at text height 0.349",
      builtBy: "make-fixtures.mjs — do not hand-edit",
      kept: "the item table verbatim; above the COMMERCIAL INVOICE title the labels, positions and text heights are real and the values are replaced character-for-character",
      expected: { lines: lines.length, runs: runs.length },
      runs: rawFixture(runs, titleY),
    };
    const rawOut = path.join(OUT, `${raw.name}.json`);
    fs.writeFileSync(rawOut, JSON.stringify(raw, null, 1) + "\n");
    console.log(`  ok  ${raw.name.padEnd(24)} ${runs.length} runs -> ${lines.length} regels  ` +
                `${Math.round(fs.statSync(rawOut).size / 1024)} KB`);
  }

  const out = path.join(OUT, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`  ok  ${name.padEnd(24)} ${String(rows.length).padStart(4)} regels  ` +
              `qty=${fixture.expected.quantity}/${footer.qty}  ${kb} KB`);
}
