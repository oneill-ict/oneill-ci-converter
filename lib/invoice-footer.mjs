// Reads the totals the invoice prints for itself.
//
// Flattening the PDF is right here: "Goods total 226 8.429,10 CHF" is a run of
// prose, not a table, so it needs no geometry. The item rows are the part that
// does — see invoice-rows.mjs.
//
// Lives in lib/ rather than inside the handler so the test harnesses can import
// it. They used to keep their own copy of the parser, which drifted: the copy's
// boilerplate regex was missing two of the item-number formats production had
// gained, so the batch test passed while not exercising what shipped.

export function parseEuropeanNumber(s) {
  if (!s) return 0;
  // "1.234,56" → 1234.56
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}

export const round2 = (n) => Math.round(n * 100) / 100;

// A well-formed European amount: "0,00", "1.155,47", "500,00", "913304,16".
// Rejects a spurious leading zero ("01.155,47"), which is what keeps the split
// of a glued run unique.
export const AMOUNT_RE = /^(?:0|[1-9]\d{0,2}(?:\.\d{3})*|[1-9]\d*),\d{2}$/;

// A negative amount anywhere in the footer means a credit note. Detected rather
// than parsed: the per-line reader has no sign handling, so a credit note comes
// out with every amount positive AND the qty/price run shifted by one character
// — two lines of -17,39 became +34,78 in the workbook. Reading the footer
// total as negative without fixing the lines made that worse, not better: the
// invoice then failed validation and the auto-force downloaded the wrong file.
// Refusing is the honest state until there is a real credit note to build on.
const NEGATIVE_AMOUNT_RE = /-\d[\d.]*,\d{2}/;

export function readGoodsTotal(flatText) {
  const CUR = /(?:CHF|EUR|GBP|USD|CAD)/.source;

  // Stop before the tariff breakdown. Its column header reads "Tariff No.Subtotal"
  // followed directly by a tariff number and amount, so a Subtotal search that ran
  // past this point could read "Subtotal420292989089,10" and set the expected total
  // to 420 billion — a guaranteed false mismatch on a perfectly parsed invoice.
  const tariffTableAt = flatText.toLowerCase().indexOf("subtotal tariff no.");
  let zone = tariffTableAt >= 0 ? flatText.slice(0, tariffTableAt) : flatText;
  // If the tariff breakdown happens to precede the footer, cutting at it would
  // leave no goods total at all. Fall back to the whole text rather than refuse.
  if (!/Goods total/i.test(zone)) zone = flatText;

  // One pass over both layouts, taking the LAST occurrence. Trying the spaced
  // layout first across the whole document let a spaced per-page subtotal beat a
  // glued grand total further down.
  //   spaced: "Goods total226 8.429,10 CHF"   → two runs
  //   glued:  "Goods total2913.304,16 EUR"    → one run
  // Credit-note detection runs on the footer window BEFORE the pattern match,
  // because on a glued credit note ("Goods total29-3.304,16") the pattern does
  // not match at all — the run stops at the minus. Checking afterwards would
  // silently miss exactly the shape that matters. See NEGATIVE_AMOUNT_RE.
  let gtPos = -1;
  for (const m of zone.matchAll(/Goods total/gi)) gtPos = m.index;
  if (gtPos >= 0 && NEGATIVE_AMOUNT_RE.test(zone.slice(gtPos, gtPos + 300))) {
    return { qty: null, total: null, creditNote: true };
  }

  let last = null;
  // A minus is only ever a leading sign here, never mid-run. Allowing it anywhere
  // inside the class turned a hyphenated token like "12-34" into a confident
  // quantity of 12, and let parseInt produce NaN — which passes every
  // `!== null` guard and then fails every equality check.
  for (const m of zone.matchAll(new RegExp(`Goods total\\s*(-?[\\d.,]+)(?:\\s+(-?[\\d.,]+))?\\s*${CUR}`, "gi"))) last = m;
  if (!last) return { qty: null, total: null };

  if (last[2] !== undefined) {
    const q = parseInt(last[1], 10);
    // NaN would satisfy `!== null` and fail every comparison, producing a
    // guaranteed mismatch reported as "expected: null".
    if (!Number.isFinite(q)) return { qty: null, total: null };
    return { qty: q, total: parseEuropeanNumber(last[2]) };
  }

  // Glued: pin the amount from the footer rows that follow. `\s*` after each
  // label because templates that glue the goods-total run still space the rest
  // ("Subtotal  12.750,23") — requiring a digit immediately after the label made
  // this whole branch inert on exactly that combination.
  const tail = zone.slice(last.index);
  const subM = new RegExp(`Subtotal\\s*(-?[\\d.,]+)\\s*${CUR}`, "i").exec(tail);
  if (!subM) return { qty: null, total: null };
  // Only a Discount sitting between the goods total and the subtotal belongs to
  // this footer. Scanning the whole tail also picked up an unrelated discount
  // printed after "Total", inflating the target and forcing a false mismatch.
  const discM = new RegExp(`Discount\\s*(-?[\\d.,]+)\\s*${CUR}`, "i").exec(tail.slice(0, subM.index));
  const target = round2(parseEuropeanNumber(subM[1]) + (discM ? parseEuropeanNumber(discM[1]) : 0));

  // Split the run so the amount equals the target.
  const run = last[1];
  for (let i = 1; i < run.length; i++) {
    const qStr = run.slice(0, i), aStr = run.slice(i);
    if (!/^\d+$/.test(qStr)) break;
    if (!AMOUNT_RE.test(aStr)) continue;
    if (Math.abs(parseEuropeanNumber(aStr) - target) < 0.005) {
      return { qty: parseInt(qStr, 10), total: parseEuropeanNumber(aStr) };
    }
  }
  // No split reproduces the target, so the target itself is not trustworthy
  // either — refuse rather than report a figure nothing in the run confirms.
  return { qty: null, total: null };
}

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

  return {
    quantity, total, gap, allowance,
    qtyOk:   footer.qty   == null || quantity === footer.qty,
    totalOk: footer.total == null || gap <= allowance,
    qtyChecked:   footer.qty   != null,
    totalChecked: footer.total != null,
  };
}
