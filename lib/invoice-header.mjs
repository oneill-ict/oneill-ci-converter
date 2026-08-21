// Reads the invoice-level fields from the block above the item table.
//
// This was the last part still parsed out of flattened text, and it was left that way
// for a specific reason: the recipient's address and the shipper's sit side by side at
// the same height, so rebuilding one string from the runs interleaves them. Reading them
// as columns solves that — measured against the old regex, column reading gives
// byte-identical output on all 45 corpus invoices.
//
// Two things this fixes that flattening could not:
//
//   A label finds its own value. The old rule was a regex per field over the whole
//   document — /Date:\s*([\d\-]+)/ and friends — which would happily match the first
//   date-shaped thing anywhere after any "Date:". Here the value is the run to the right
//   of the label on the same line, which is what the layout actually means.
//
//   The address is a column, not a paragraph. The old rule took everything between
//   "Billing address" and "O'Neill Europe B.V." and split on newlines, which worked only
//   because pdf-parse happened to emit those lines consecutively.

// The labels worth reading. Every one is printed with its colon, and the value is the
// next run to the right on the same line.
const FIELDS = {
  date:           "Date:",
  orderNumber:    "Order number:",
  deliveryTerms:  "Delivery terms:",
  numberOfBoxes:  "Number of boxes:",
  grossWeight:    "Gross weight:",
};

// Anything ending in a colon in this block is a label, so a label followed immediately by
// another label means the value is simply absent — better an empty field than the next
// field's label read as this field's value.
const LOOKS_LIKE_LABEL = /:$/;

/** The value printed to the right of `label`, or "" when there is none. */
function valueFor(lines, label) {
  for (const line of lines) {
    const i = line.runs.findIndex(r => r.text.trim() === label);
    if (i < 0) continue;
    const next = line.runs[i + 1];
    if (!next || LOOKS_LIKE_LABEL.test(next.text.trim())) return "";
    return next.text.trim();
  }
  return "";
}

/**
 * The lines that make up an address column: everything below the given label, in the
 * same column, until the block ends.
 *
 * The end is found by the gap between lines rather than by a fixed count. Address blocks
 * are four to five lines with even spacing, and the next block down sits far below —
 * measured on the corpus, an address line is ~11 points below the previous one and the
 * gap to whatever follows is 40 or more.
 */
function columnUnder(lines, label, { xTolerance = 6, gapFactor = 2.5 } = {}) {
  const headerIdx = lines.findIndex(l => l.runs.some(r => r.text.trim().toLowerCase() === label));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx];
  const anchor = header.runs.find(r => r.text.trim().toLowerCase() === label).x;

  const out = [];
  let previousY = header.y;
  let spacing = null;
  for (const line of lines.slice(headerIdx + 1)) {
    if (line.page !== header.page) break;
    const cell = line.runs
      .filter(r => Math.abs(r.x - anchor) <= xTolerance)
      .map(r => r.text.trim())
      .join(" ")
      .trim();
    // Lines with nothing in this column belong to a neighbouring one — the shipper block
    // sits at the same height as the address — so they are skipped, not treated as the
    // end of the block.
    if (!cell) continue;
    const gap = previousY - line.y;
    // The first gap sets the block's own line spacing; a later gap much larger than that
    // means this line belongs to whatever comes next.
    if (spacing != null && gap > spacing * gapFactor) break;
    if (spacing == null) spacing = gap;
    out.push(cell);
    previousY = line.y;
  }
  return out;
}

/**
 * Read the invoice-level fields.
 * `lines` is the whole document as returned by extractLines.
 */
export function readHeader(lines) {
  // Bounded to what sits above the item table, so a label repeated in the legal footer
  // cannot win. Falls back to the whole document when there is no title — a packing list,
  // for instance, which has no item table either.
  const titleIdx = lines.findIndex(l => l.runs.some(r => /COMMERCIAL INVOICE/i.test(r.text)));
  const head = titleIdx > 0 ? lines.slice(0, titleIdx) : lines;

  const out = {};
  for (const [key, label] of Object.entries(FIELDS)) out[key] = valueFor(head, label);

  const address = columnUnder(head, "billing address");
  out.billingName    = address[0] || "";
  out.billingAddress = address.slice(1);

  // Spedag / Kaiseraugst as the ship-to means a B2B invoice.
  out.isB2B = [out.billingName, ...out.billingAddress].some(l => /spedag|kaiseraugst/i.test(l));

  return out;
}
