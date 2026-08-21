// Reads the totals the invoice prints for itself, and compares them with what the row
// reader produced.
//
// There used to be a second reader here that worked on the flattened text, with real
// machinery behind it: the "glued" footer layout ("Goods total2913.304,16 EUR"), the
// Subtotal-minus-Discount arithmetic needed to split that run unambiguously, and a
// bounded search zone so a per-page subtotal could not shadow the grand total. None of
// it was in the document — see the note above readFooter. It is deleted rather than kept
// as a fallback: a second implementation of the same thing is how this repository ended
// up with a green test against a parser that had not shipped for two changes.

function parseEuropeanNumber(s) {
  if (!s) return 0;
  // "1.234,56" → 1234.56
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}

export const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Does what the reader produced agree with what the invoice prints for itself?
 *
 * The one place this rule lives. It used to sit inside the handler and be restated in
 * each test harness, which is the same drift that let a stale copy of the parser keep
 * a batch test green while production had moved on.
 *
 * `rows` need only carry quantity, total, price and discount.
 */
export function agreesWithFooter(rows, footer) {
  const quantity = rows.reduce((s, r) => s + r.quantity, 0);
  const total    = round2(rows.reduce((s, r) => s + r.total, 0));

  // The printed unit price is rounded to 2 decimals while the line total is computed
  // from the unrounded one — 2 x 28,83 prints as 57,65, not 57,66 — so the footer can
  // differ from the sum of the printed line totals by up to half a cent per affected
  // line. The bound comes from that count rather than being picked, and stays far below
  // the value of any real missing line.
  const roundedLines = rows.filter(r =>
    r.price != null &&
    Math.abs(round2(r.quantity * r.price - r.discount) - r.total) > 0.001).length;
  const allowance = roundedLines * 0.5 + 1;

  // In whole cents: at 0.03 against a 0.03 bound, binary floating point put the
  // difference 2e-13 over and the check failed on noise rather than on money.
  const cents = (n) => Math.round(n * 100);
  const gap = footer.total == null ? null
            : Math.abs(cents(total) - cents(footer.total));

  // The end total, which nothing used to check. The invoice prints four figures that can
  // be reconciled — Goods total, Discount, Shipping costs, VAT — and only the first was
  // compared. A component the reader failed to see therefore vanished in silence: fifteen
  // real invoice discounts, up to EUR 62,750.50, and two shipping-cost lines. Measured
  // across the corpus, all 42 invoices satisfy
  //
  //   Total = Goods total - Discount + Shipping costs + VAT
  //
  // so a mismatch means this converter misread one of them, not that the invoice is odd.
  const endTotal = footer.grandTotal == null ? null
    : round2(total - (footer.discount || 0) + (footer.shipping || 0) + (footer.vat || 0));
  const endGap = endTotal == null ? null
    : Math.abs(cents(endTotal) - cents(footer.grandTotal));

  return {
    quantity, total, gap, allowance,
    endTotal, endGap, printedEndTotal: footer.grandTotal ?? null,
    qtyOk:   footer.qty   == null || quantity === footer.qty,
    totalOk: footer.total == null || gap <= allowance,
    // Same allowance: the end total inherits the goods total's rounding and adds nothing
    // of its own, since discount, shipping and VAT are printed exactly.
    endTotalOk: footer.grandTotal == null || endGap <= allowance,
    qtyChecked:      footer.qty        != null,
    totalChecked:    footer.total      != null,
    endTotalChecked: footer.grandTotal != null,
  };
}

// ── The same totals, read from positions ────────────────────────────────────
// readGoodsTotal above works on flattened text and carries a lot of machinery for it:
// the "glued" layout ("Goods total2913.304,16 EUR"), the Subtotal-plus-Discount
// arithmetic needed to split that run unambiguously, and a bounded search zone so a
// per-page subtotal cannot shadow the grand total.
//
// None of that is in the document. In positions the line reads
//
//   16:"Goods total"   625:"291"   775:"3.304,16 EUR"
//
// as three separate runs. The gluing was ours.

const CURRENCY = /(?:CHF|EUR|GBP|USD|CAD)/;
const AMOUNT   = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/;

// A summary line: the label is the leftmost run and only figures follow it. The column
// header row also contains the words "Discount" and "Total", but it carries ten to
// twelve runs, so a cap of three excludes it without needing to know where the item
// table ended.
function summaryLine(lines, label) {
  let found = null;
  for (const line of lines) {
    if (line.runs.length > 3) continue;
    if (line.runs[0].text.trim().toLowerCase() !== label) continue;
    // The last occurrence: per-page subtotals come before the grand total.
    found = line;
  }
  return found;
}

const amountOf = (run) => {
  const t = run.text.replace(CURRENCY, "").trim();
  return AMOUNT.test(t) ? parseEuropeanNumber(t) : null;
};

/**
 * Reads the invoice's own totals from positioned lines.
 *
 * The summary block is Goods total, then any of Discount and Shipping costs, then
 * Subtotal, VAT and Total. Discount subtracts and Shipping costs adds:
 *
 *   Subtotal = Goods total - Discount + Shipping costs
 *   Total    = Subtotal + VAT
 *
 * Both printed figures are returned so the caller can check its own arithmetic against
 * them rather than trusting it.
 */
export function readFooter(lines) {
  // `total` is the goods total — the figure the item rows have to add up to. `grandTotal`
  // is what the invoice says the customer owes, at the bottom of the same block. They are
  // different numbers and conflating them is how a missing component stays invisible:
  // nothing compared the workbook's end total with the printed one, so an unread Discount
  // or Shipping costs line simply vanished.
  const out = { qty: null, total: null, creditNote: false,
                discount: 0, vat: 0, shipping: 0, subtotal: null, grandTotal: null };

  const gt = summaryLine(lines, "goods total");
  if (gt) {
    const figures = gt.runs.slice(1);
    const amount = figures.length ? amountOf(figures[figures.length - 1]) : null;
    // The quantity is a bare whole number; the amount always carries decimals. When only
    // one figure follows the label there is no quantity to read.
    const qtyRun = figures.length > 1 ? figures[figures.length - 2] : null;
    const qty = qtyRun && /^-?\d+$/.test(qtyRun.text.trim()) ? parseInt(qtyRun.text, 10) : null;
    out.qty   = Number.isFinite(qty) ? qty : null;
    out.total = amount;
  }

  for (const [key, label] of [["discount", "discount"], ["vat", "vat"],
                             ["shipping", "shipping costs"],
                             ["subtotal", "subtotal"], ["grandTotal", "total"]]) {
    const line = summaryLine(lines, label);
    if (!line || line.runs.length < 2) continue;
    const v = amountOf(line.runs[line.runs.length - 1]);
    if (v != null) out[key] = v;
  }

  // A negative anywhere in the summary block means a credit note. Detected rather than
  // parsed: the row reader has no sign handling, so a credit note would come out with
  // every amount positive. Refusing is the honest state until there is one to build on.
  for (const label of ["goods total", "discount", "subtotal", "vat", "total"]) {
    const line = summaryLine(lines, label);
    if (!line) continue;
    if (line.runs.some(r => /-\d[\d.]*,\d{2}/.test(r.text))) out.creditNote = true;
  }
  if (out.creditNote) { out.qty = null; out.total = null; }

  return out;
}
