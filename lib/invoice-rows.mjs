// Reads invoice line items from the PDF's own table geometry.
//
// The existing parser flattens the PDF to one string and then reconstructs the
// columns with regexes. That is where nearly every defect in this converter came
// from: the flattening glues neighbouring cells together, so "1" and "19,94"
// become "119,94" and the quantity has to be guessed by trying every split and
// checking which one reproduces the line total. That guess needed a tolerance,
// the tolerance needed to scale with quantity, a bad guess needed a warning, and
// the warning needed wiring into every screen.
//
// None of that is necessary. A PDF text run carries its position, and pdf-parse
// only discards it — the underlying pdf.js exposes it, and pdf-parse lets us
// replace its render step. Measured across the 45-invoice corpus: 2,469 item
// rows, and in every single one the quantity is a separate run from the price.
//
// Two things the corpus taught us, both of which shape the design:
//
//   - The column *grid* is defined by the data, not the header. Two real columns
//     (country of origin, price per piece) have no header text at all, and the
//     weight header reads "Nett weight" on some templates. So the grid is derived
//     from the item rows themselves and the header is used only to name it.
//
//   - A run that fits no column must never be folded into its neighbour. An
//     earlier version did, and a "380,00 gr" weight landed in the quantity cell
//     and read as 380 — a plausible wrong number, which is the exact failure mode
//     this rewrite exists to end. Unplaceable runs are now reported, and the
//     number parsers refuse anything they do not fully understand.
//
// This module does one thing: turn a PDF buffer into typed item rows. It holds no
// validation, no Excel concerns and no invoice-level fields.

// Header labels as printed, per template variant seen in the corpus. Columns
// absent from this list are still found as grid columns; they just stay unnamed
// until inferColumns() places them.
const HEADER_LABELS = {
  itemNo:    ["item no."],
  item:      ["item"],
  colour:    ["colour", "color"],
  colourNo:  ["colour no.", "color no."],
  itemGroup: ["item group"],
  country:   ["country of origin", "country of", "country"],
  tariffNo:  ["tariff no."],
  weight:    ["nett weight", "net weight", "gross weight", "weight"],
  quantity:  ["quantity", "qty"],
  price:     ["price per piece", "price per", "price"],
  discount:  ["discount"],
  total:     ["total"],
};

// Runs on the same visual line share a y within this many points. Invoice rows
// are ~13pt apart, so 2 is comfortably inside one row.
const Y_TOLERANCE = 2;

// A run belongs to a grid column if its left edge is within this many points.
// Observed column spacing is 45–60pt, so 12 cannot reach a neighbour.
const X_TOLERANCE = 12;

// A grid column has to appear on at least this share of item rows. Below that it
// is a stray run — a wrapped item name, a footnote — not a column.
const MIN_COLUMN_SHARE = 0.5;

/**
 * Extract every text run with its position, grouped into visual lines.
 * Lines run top-to-bottom, page by page; runs within a line left-to-right.
 */
export async function extractLines(pdfBuffer, pdfParse) {
  const runs = [];
  await pdfParse(pdfBuffer, {
    max: 100,
    pagerender: async (pageData) => {
      const page = pageData.pageIndex + 1;
      // disableCombineTextItems keeps neighbouring cells apart — combining them
      // is exactly the gluing this module exists to avoid.
      const tc = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: true,
      });
      for (const it of tc.items) {
        const text = (it.str || "").trim();
        if (!text) continue;
        const [, , , , x, y] = it.transform;
        runs.push({ page, x, y, text });
      }
      return "";                      // the joined text is not used here
    },
  });

  const byLine = new Map();
  for (const r of runs) {
    const key = `${r.page}:${Math.round(r.y / Y_TOLERANCE)}`;
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key).push(r);
  }
  return [...byLine.values()]
    .map(items => ({
      page: items[0].page,
      y: items[0].y,
      runs: items.sort((a, b) => a.x - b.x),
    }))
    .sort((a, b) => a.page - b.page || b.y - a.y);
}

// An item row carries a bare 10-digit tariff number and enough filled cells to
// be the item table rather than the tariff-subtotal block underneath it, which
// also holds 10-digit numbers but only two or three runs per line.
function looksLikeItemRow(line) {
  return line.runs.length >= 8 && line.runs.some(r => /^\d{10}$/.test(r.text));
}

/**
 * Derive the column grid from the item rows themselves: cluster the observed
 * left edges and keep the clusters that recur on most rows.
 */
export function buildGrid(lines) {
  const itemRows = lines.filter(looksLikeItemRow);
  if (itemRows.length === 0) return [];

  const counts = new Map();
  for (const line of itemRows) {
    // One vote per row per column, so a wrapped cell cannot inflate a cluster.
    const seen = new Set();
    for (const run of line.runs) seen.add(Math.round(run.x));
    for (const x of seen) counts.set(x, (counts.get(x) || 0) + 1);
  }

  // Merge positions within tolerance into one column, weighted by how often each
  // exact position occurs, so the grid sits where the data actually sits.
  const sorted = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  const clusters = [];
  for (const [x, n] of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.members[last.members.length - 1][0] <= X_TOLERANCE) {
      last.members.push([x, n]);
    } else {
      clusters.push({ members: [[x, n]] });
    }
  }

  const threshold = itemRows.length * MIN_COLUMN_SHARE;
  return clusters
    .map(c => {
      const rows = c.members.reduce((s, [, n]) => s + n, 0);
      const [x]  = c.members.reduce((a, b) => (b[1] > a[1] ? b : a));
      return { x, rows };
    })
    .filter(c => c.rows >= threshold)
    .sort((a, b) => a.x - b.x);
}

/** Name grid columns from the header row, where the header names them at all. */
function nameFromHeader(lines, grid) {
  const header = lines.find(l => l.runs.some(r => /^item no\.?$/i.test(r.text)));
  if (!header) return { names: new Array(grid.length).fill(null), header: null };

  const names = new Array(grid.length).fill(null);
  for (const [key, labels] of Object.entries(HEADER_LABELS)) {
    // Longest label first so "Colour no." wins over "Colour".
    const wanted = [...labels].sort((a, b) => b.length - a.length);
    const hit = header.runs.find(r => wanted.some(l => r.text.toLowerCase() === l))
             ?? header.runs.find(r => wanted.some(l => r.text.toLowerCase().startsWith(l)));
    if (!hit) continue;
    // Attach to the nearest grid column, but only if the header sits over it.
    let best = -1, bestD = Infinity;
    grid.forEach((c, i) => {
      const d = Math.abs(c.x - hit.x);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD <= X_TOLERANCE * 2 && names[best] == null) names[best] = key;
  }
  return { names, header };
}

/**
 * Name the columns the header leaves out, using the data instead of assuming a
 * position. Country of origin and price per piece are unlabelled on every
 * template in the corpus, so each is identified by what its cells contain and
 * then confirmed before it is trusted.
 *
 * Confirming the price column also settles how the invoice states its discount.
 * There are two conventions:
 *
 *   per line    quantity x price - discount     = total
 *   per piece   quantity x (price - discount)   = total
 *
 * Only a row with a real discount on more than one piece can tell them apart. The
 * corpus has one template using per piece, and the first version of this module
 * tested only the per-line form: on that invoice the price column failed its check,
 * stayed unnamed, and shipped 29 empty "Price per piece" cells while the quantity
 * and the total still matched the invoice footer. Green validation, missing data.
 *
 * The tolerances below scale with quantity because the printed figures are rounded
 * to 2 decimals: per line only the price is rounded, per piece both the price and
 * the discount are, so the per-piece bound is twice as wide. These tolerances decide
 * which of two known conventions a template uses — they never decide a value. Every
 * number still comes from its own column, and if neither convention holds the price
 * column stays unnamed rather than being filled with something plausible.
 */
function inferColumns(lines, grid, names) {
  const itemRows = lines.filter(looksLikeItemRow);
  const cellAt = (line, j) =>
    line.runs.find(r => Math.abs(r.x - grid[j].x) <= X_TOLERANCE)?.text;
  const sample = (i) => itemRows.map(l => cellAt(l, i)).filter(Boolean);

  const qtyIdx   = names.indexOf("quantity");
  const discIdx  = names.indexOf("discount");
  const totIdx   = names.indexOf("total");
  const tariffIx = names.indexOf("tariffNo");
  let discountPerPiece = false;

  if (qtyIdx >= 0 && totIdx >= 0 && discIdx > qtyIdx + 1) {
    for (let i = qtyIdx + 1; i < discIdx; i++) {
      if (names[i] != null) continue;
      const cells = sample(i);
      if (cells.length < 3 || !cells.every(t => parseAmount(t) != null)) continue;

      let checked = 0, asLine = 0, asPiece = 0, discriminating = 0, piecePreferred = 0;
      for (const row of itemRows) {
        const q = parseAmount(cellAt(row, qtyIdx));
        const p = parseAmount(cellAt(row, i));
        const d = parseAmount(cellAt(row, discIdx)) ?? 0;
        const t = parseAmount(cellAt(row, totIdx));
        if (q == null || p == null || t == null) continue;
        checked++;
        const okLine  = Math.abs(round2(q * p - d)   - t) <= Math.abs(q) * 0.005 + 0.01;
        const okPiece = Math.abs(round2(q * (p - d)) - t) <= Math.abs(q) * 0.01  + 0.01;
        if (okLine)  asLine++;
        if (okPiece) asPiece++;
        // A zero discount, or a single piece, satisfies both forms and so says
        // nothing about which one this template uses.
        if (d !== 0 && Math.abs(q) > 1) {
          discriminating++;
          if (okPiece && !okLine) piecePreferred++;
        }
      }
      if (checked < 3) continue;
      if (asLine / checked < 0.9 && asPiece / checked < 0.9) continue;

      names[i] = "price";
      // Only rows that can discriminate get a say, so a template with no discounts
      // at all stays on the per-line reading — the default shape of the workbook's
      // Discount column.
      discountPerPiece = discriminating > 0 && piecePreferred / discriminating >= 0.9;
      break;
    }
  }

  // Country of origin: the unnamed column left of the tariff number whose cells
  // are plain words, never numbers.
  if (tariffIx > 0) {
    for (let i = tariffIx - 1; i >= 0; i--) {
      if (names[i] != null) continue;
      const cells = sample(i);
      if (cells.length >= 3 && cells.every(t => /^[A-Za-z][A-Za-z .'-]*$/.test(t))) {
        names[i] = "country";
        break;
      }
    }
  }
  return { names, discountPerPiece };
}

const round2 = (n) => Math.round(n * 100) / 100;

const stripCurrency = (s) => s.replace(/\s*(?:CHF|EUR|GBP|USD|CAD)\s*$/i, "").trim();

/**
 * "1.234,56" or "1.234,56 CHF" -> 1234.56. Returns null for anything else,
 * including "380,00 gr" — refusing to half-understand a cell is what keeps a
 * misplaced run from becoming a plausible wrong number.
 */
export function parseAmount(s) {
  const t = stripCurrency(String(s ?? "").trim());
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(t)) return null;
  const n = parseFloat(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** "380,00 gr" -> 380 · anything else -> null */
export function parseWeight(s) {
  const m = /^(-?[\d.]+(?:,\d+)?)\s*(?:gr|g|kg)$/i.exec(String(s ?? "").trim());
  if (!m) return null;
  const n = parseAmount(m[1]);
  return n == null ? null : /kg$/i.test(s.trim()) ? n * 1000 : n;
}

/**
 * Read the item rows out of positioned lines.
 * Every field comes from its own column; nothing is inferred from a neighbour.
 *
 * Returns { rows, columns, skipped, unplaced } — `skipped` holds rows that look
 * like item rows but lack a usable tariff number, quantity or total, and
 * `unplaced` counts runs that fit no column. Both are facts for the caller to
 * report, never silently dropped.
 */
export function readItemRows(lines) {
  const grid = buildGrid(lines);
  if (grid.length === 0) return { rows: [], columns: [], skipped: [], unplaced: 0 };

  let { names } = nameFromHeader(lines, grid);
  let discountPerPiece;
  ({ names, discountPerPiece } = inferColumns(lines, grid, names));

  const columns = grid.map((c, i) => ({ x: c.x, key: names[i], rows: c.rows }));
  const required = ["tariffNo", "quantity", "total"];
  if (required.some(k => !names.includes(k))) {
    return { rows: [], columns, skipped: [], unplaced: 0, missingColumns: required.filter(k => !names.includes(k)) };
  }

  const rows = [];
  const skipped = [];
  let unplaced = 0;

  for (const line of lines) {
    if (!looksLikeItemRow(line)) continue;

    const cells = {};
    let lineUnplaced = 0;
    for (const run of line.runs) {
      let best = -1, bestD = Infinity;
      grid.forEach((c, i) => {
        const d = Math.abs(run.x - c.x);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best < 0 || bestD > X_TOLERANCE || names[best] == null) { lineUnplaced++; continue; }
      const key = names[best];
      cells[key] = cells[key] ? `${cells[key]} ${run.text}` : run.text;
    }
    unplaced += lineUnplaced;

    const tariffNo = (cells.tariffNo || "").trim();
    const quantity = parseAmount(cells.quantity);
    const total    = parseAmount(cells.total);
    const printedDiscount = parseAmount(cells.discount) ?? 0;

    if (!/^\d{10}$/.test(tariffNo) || quantity == null || total == null) {
      skipped.push({
        page: line.page,
        // The item number usually still reads even when a money cell does not, and
        // it is what the user needs in order to find the line on the invoice.
        itemNo: (cells.itemNo || "").trim(),
        reason: !/^\d{10}$/.test(tariffNo) ? "geen tariefnummer"
              : quantity == null ? "geen aantal" : "geen regeltotaal",
        text: line.runs.map(r => r.text).join(" ").slice(0, 160),
      });
      continue;
    }

    rows.push({
      itemNo:      (cells.itemNo   || "").trim(),
      item:        (cells.item     || "").trim(),
      colour:      (cells.colour   || "").trim(),
      colourNo:    (cells.colourNo || "").trim(),
      itemGroup:   (cells.itemGroup|| "").trim(),
      country:     (cells.country  || "").trim(),
      tariffNo,
      weight:      parseWeight(cells.weight),
      quantity,
      price:       parseAmount(cells.price),
      // Always the discount for the whole line, whichever way the invoice states
      // it, so the workbook's Discount column means one thing everywhere and
      // quantity x price - discount reconciles against the total on every template.
      discount:    round2(printedDiscount * (discountPerPiece ? Math.abs(quantity) : 1)),
      total,
      page:        line.page,
    });
  }

  // The currency belongs to the money cells, so read it from them. The old parser
  // took it from the flattened document, where a header or a terms paragraph
  // naming another currency could set the whole export to the wrong one.
  const totalIdx = names.indexOf("total");
  let currency = null;
  for (const line of lines) {
    if (!looksLikeItemRow(line)) continue;
    const cell = line.runs.find(r => Math.abs(r.x - grid[totalIdx].x) <= X_TOLERANCE)?.text;
    const m = cell && /\b(CHF|EUR|GBP|USD|CAD)\b/.exec(cell);
    if (m) { currency = m[1]; break; }
  }

  return { rows, columns, skipped, unplaced, currency, discountPerPiece };
}
