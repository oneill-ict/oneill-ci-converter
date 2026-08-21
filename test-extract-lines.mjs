// Tests the step that turns positioned runs into visual lines.
//
// This was the hole in the safety net, and it was invisible for a good reason: the other
// fixtures store the *output* of this step, so changing it cannot make them fail. Proved
// by accident — the grouping rule went from a fixed 2-point bucket to one relative to
// text height, all 96 fixture assertions stayed green, and only regenerating the files
// showed that one had moved. Every field downstream is shaped by these lines.
//
// The fixture holds the runs before grouping, from the one invoice whose invoice-level
// block renders at text height 0.349 instead of 7.5 — the case a fixed tolerance gets
// wrong. Its labels, positions and heights are real; its values are replaced, because the
// geometry is what is under test here and the content is not.
//
// Run: node test-extract-lines.mjs

import fs from "node:fs";
import { groupIntoLines } from "./lib/invoice-rows.mjs";

const fx = JSON.parse(fs.readFileSync("test/fixtures/large-quantities-raw-runs.json", "utf8"));

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = Object.is(got, want);
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const lines = groupIntoLines(fx.runs);
const textOf = (l) => l.runs.map(r => r.text).join(" ");
const lineWith = (needle) => lines.filter(l => l.runs.some(r => r.text.trim() === needle));

console.log("\n  wat er in gaat en uit komt");
eq("runs in de fixture", fx.runs.length, fx.expected.runs);
eq("regels na groeperen", lines.length, fx.expected.lines);
eq("geen run verdwijnt", lines.reduce((s, l) => s + l.runs.length, 0), fx.runs.length);

console.log("\n  het kopblok op teksthoogte 0,35 scheidt in aparte regels");
{
  // These four labels sit 0.7 points apart. A fixed 2-point tolerance merged all four
  // into one line, and then "the run to the right of the label" found the next label
  // instead of the value.
  for (const label of ["Date:", "Order number:", "Delivery terms:", "VAT number:"]) {
    const found = lineWith(label);
    eq(`${label} staat op precies een regel`, found.length, 1);
    // Its own value must be the next run, not another label.
    const line = found[0];
    const i = line.runs.findIndex(r => r.text.trim() === label);
    const next = line.runs[i + 1];
    eq(`${label} heeft een waarde naast zich`, !!next && !next.text.trim().endsWith(":"), true);
  }
  const dateLine = lineWith("Date:")[0];
  eq("en geen tweede label op die regel",
     dateLine.runs.filter(r => /^(Order number|Delivery terms|VAT number):$/.test(r.text.trim())).length, 0);
}

console.log("\n  een vaste tolerantie doet dat aantoonbaar slechter");
{
  // The rule this replaced, kept here as the comparison rather than as prose.
  const fixedBucket = (runs) => {
    const m = new Map();
    for (const r of runs) {
      const k = `${r.page}:${Math.round(r.y / 2)}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.values()].map(v => ({ runs: v.sort((a, b) => a.x - b.x) }));
  };
  // Two labels on one line is not itself wrong: this header has a left and a right column
  // of label/value pairs on the same row ("Date: | 01-07-2025 | Transport: | DIR"). What
  // is wrong is a label from the row *below* landing on the same line.
  //
  // Which rows the old rule merged was pure luck of the bucket edge, and that is the
  // sharper point against it. The four labels sit at y = 443.13, 442.43, 441.73, 441.04.
  // Divided by 2 and rounded, the first lands in bucket 222 and the other three all land
  // in 221 — so Date came out fine and the three below it collapsed into one line, where
  // the run beside "Order number:" was "Delivery terms:" rather than the order number.
  const old = fixedBucket(fx.runs);
  const labelsOn = (line) => line.runs.filter(r => /^(Date|Order number|Delivery terms|VAT number):$/
    .test(r.text.trim())).map(r => r.text.trim());
  const oldOrderLine = old.filter(l => l.runs.some(r => r.text.trim() === "Order number:"))[0];

  eq("de oude regel plakt drie rijen op een regel", labelsOn(oldOrderLine).length, 3);
  eq("en de waarde naast Order number: was een label",
     oldOrderLine.runs[oldOrderLine.runs.findIndex(r => r.text.trim() === "Order number:") + 1]
       .text.trim().endsWith(":"), true);
  eq("de nieuwe regel houdt er een over", labelsOn(lineWith("Order number:")[0]).length, 1);
}

console.log("\n  de artikeltabel blijft een regel per artikel");
{
  const itemRows = lines.filter(l => l.runs.length >= 8 && l.runs.some(r => /^\d{10}$/.test(r.text)));
  eq("artikelregels gevonden", itemRows.length, 21);
  eq("elke artikelregel heeft twaalf cellen",
     itemRows.every(l => l.runs.length === 12), true);
  // Row spacing here is 13.5 points against text height 7.5, so nothing may merge.
  eq("geen enkele artikelregel bevat twee tariefnummers",
     itemRows.every(l => l.runs.filter(r => /^\d{10}$/.test(r.text)).length === 1), true);
}

console.log("\n  ordening");
{
  eq("regels lopen per pagina van boven naar beneden",
     lines.every((l, i) => i === 0 || l.page > lines[i - 1].page || l.y <= lines[i - 1].y), true);
  eq("runs binnen een regel lopen van links naar rechts",
     lines.every(l => l.runs.every((r, i) => i === 0 || r.x >= l.runs[i - 1].x)), true);
}

console.log("\n  eigenschappen die los van deze factuur gelden");
{
  // Same y, different page: never one line. Without the page check, a two-page invoice
  // would fold its rows together.
  const twoPages = groupIntoLines([
    { page: 1, x: 10, y: 500, h: 7.5, text: "een" },
    { page: 2, x: 10, y: 500, h: 7.5, text: "twee" },
  ]);
  eq("dezelfde hoogte op twee pagina's blijft twee regels", twoPages.length, 2);

  // A degenerate height must not collapse the document into one line.
  const noHeight = groupIntoLines([
    { page: 1, x: 10, y: 500, h: 0, text: "a" },
    { page: 1, x: 10, y: 480, h: 0, text: "b" },
  ]);
  eq("hoogte 0 plakt niet alles samen", noHeight.length, 2);

  eq("geen runs, geen regels", groupIntoLines([]).length, 0);

  // The input array must not be reordered under the caller.
  const input = [
    { page: 1, x: 50, y: 100, h: 7.5, text: "tweede" },
    { page: 1, x: 10, y: 200, h: 7.5, text: "eerste" },
  ];
  const before = input.map(r => r.text).join(",");
  groupIntoLines(input);
  eq("de meegegeven lijst wordt niet omgegooid", input.map(r => r.text).join(","), before);
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
