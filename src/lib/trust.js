// Whether an export can be trusted, and what to call it.
//
// This decides what the user sees: the badge colour, the reason on a batch row, the
// marker in the downloaded filename, and what the history panel shows later. It used
// to be inline in App.jsx, where it could not be tested — so the one part of the app
// that decides whether to trust a customs document was the one part with no tests,
// while the parser behind it had two hundred assertions.
//
// Everything here is pure. No React, no DOM, no fetch.

// Six surfaces used to re-derive this independently — the badge, the batch row, the
// ZIP suffix, the history writer, the download buttons and the warnings — each looking
// at a different mix of flags. They disagreed: the same file could be amber in the
// badge, green in the history and unlabelled in the ZIP. Everything routes through
// trustOf now.
//
// The order is the order of the checks in trustOf, most severe first, and it is also
// what the legend renders. A kind missing from this list gets no legend entry.
export const TRUST_ORDER = [
  "error", "partial", "unchecked", "noweight", "uncertain", "gaps", "degraded", "nodata",
];

/**
 * @returns {{ok: boolean, kind: string}} kind is "ok" or one of TRUST_ORDER.
 */
export function trustOf(r) {
  if (!r)                     return { ok: false, kind: "error" };
  if (r.error)                return { ok: false, kind: "error" };
  if (r.isPartial)            return { ok: false, kind: "partial" };
  if (r.checked === false)    return { ok: false, kind: "unchecked" };
  if (r.noWeightCount > 0)    return { ok: false, kind: "noweight" };
  // Nothing sets uncertainCount any more — no quantity is guessed, so no line can
  // carry an unreconciled split. The check stays for history entries written while it
  // could: dropping it would quietly repaint a past amber run as green, and the export
  // that run produced is still on someone's disk with its own marker.
  if (r.uncertainCount > 0)   return { ok: false, kind: "uncertain" };
  if (r.unparsedCount > 0)    return { ok: false, kind: "gaps" };
  // Diagnostics unreadable: the absence of warnings proves nothing here.
  if (r.degraded)             return { ok: false, kind: "degraded" };
  // No quantity means the validation headers never arrived; the conversion cannot be
  // vouched for even though the response was a 200.
  if (!r.qty)                 return { ok: false, kind: "nodata" };
  return { ok: true, kind: "ok" };
}

// Which validation axis actually failed, most specific first — shared by the single
// view and the batch row so the two can never name different reasons. The final
// fallback is only reachable if both flags are missing (a stale bundle against a newer
// server, say); "unknown" avoids asserting a reason we do not have.
export function rowAxis(r) {
  if (r.qtyOk   === false) return "qty";
  if (r.totalOk === false) return "total";
  // The end total: goods total minus discount plus shipping costs plus VAT, against what
  // the invoice prints at the bottom. Last of the three because the other two point at a
  // specific line, while this one says a component of the summary block was misread. It is
  // the axis that was missing when fifteen invoice discounts and two shipping-cost lines
  // disappeared from delivered workbooks with a green check on them.
  if (r.endTotalOk === false) return "endTotal";
  return r.qtyOk === undefined && r.totalOk === undefined ? "unknown" : "qty";
}

// The figure worth quoting is always the workbook's own sum — that is the number in
// the file the user can open and check. Keying this off the axis meant the parsed
// figure was quoted whenever the quantity ALSO failed, which is most of the time, so
// the "12 cents out" case the axis fix was written for still reported 2 cents. And on
// a total-only failure it quoted a figure that appears in no delivered file at all.
export function rowTotal(r) {
  return r.total;
}

/**
 * The filename a download gets. An export that cannot be trusted carries the reason
 * in its own name, because the file outlives the screen that warned about it.
 *
 * An "error" result has no workbook to name. Everything else that is not ok gets its
 * marker, so a file on disk can always be told apart from a clean one.
 */
export function exportNameFor(r, t) {
  const { ok, kind } = trustOf(r);
  if (ok || kind === "error") return r.xlsxName;
  const suffix = t.trustSuffix[kind];
  if (!suffix) return r.xlsxName;
  return r.xlsxName.replace(/\.xlsx$/i, "") + ` ${suffix}.xlsx`;
}

// A platform-level failure (413, 504, a proxy page) has no JSON body, so the old
// fallback surfaced the bare string "HTTP 504" to a logistics colleague. Each of these
// says what happened and what to do about it.
export function httpErrorMessage(status, t) {
  if (status === 413) return t.errTooLarge;
  if (status === 504 || status === 502) return t.errTimeout;
  if (status === 429) return t.errBusy;
  if (status >= 500)  return t.errServer;
  return t.errHttp(status);
}
