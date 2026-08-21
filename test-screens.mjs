// Renders the result screens.
//
// This is the gap the audit came through. A change removed the ResultWarnings wrapper and
// left `<ResultWarnings />` standing in SingleDoneState. Converting a single file — the
// normal way this tool is used — threw ReferenceError, and with no error boundary the page
// went blank. Three things failed to notice:
//
//   `npm run build` succeeded, because esbuild leaves an unknown identifier as a global
//   reference rather than an error.
//
//   No test touched App.jsx at all. src/lib/trust.js had been extracted and tested exactly
//   because it could not be tested inside App.jsx, and the rest of the file stayed dark.
//
//   My own browser check: I loaded the page, clicked the language toggle, saw a clean
//   console and called it verified — without ever converting a file.
//
// ESLint's react/jsx-no-undef now catches that specific class. This catches the wider one:
// a screen that throws on a prop shape it actually receives. Every case below is a result
// object the app really produces, including the ones nobody looks at until something is
// wrong.
//
// App.jsx is JSX, so it is bundled with esbuild first — the same bundler vite uses — and
// rendered with react-dom/server.
//
// Run: node test-screens.mjs

import fs from "node:fs";
import * as esbuild from "esbuild";
import { renderToString } from "react-dom/server";
import React from "react";

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  console.log(`    ${cond ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`);
  cond ? pass++ : fail++;
};

// ── Bundle the app for Node ─────────────────────────────────────────────────
// Written inside the project rather than in a temp directory: the bundle imports react and
// react-dom bare, and those only resolve from somewhere under this node_modules.
const out = "_screens-bundle.mjs";
await esbuild.build({
  entryPoints: ["src/App.jsx"],
  outfile: out,
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "jszip", "lucide-react"],
  logLevel: "silent",
});
const app = await import("./" + out);

// The real Dutch locale, from the app. The first version of this test wrote out its own
// stub and eight cases failed on keys it had not thought of — t.validRows, t.filesOf. A
// screen renders with the strings it actually ships with, or the test proves nothing.
const T = app.i18n.NL;

const noop = () => {};
const render = (el) => renderToString(el);

// A clean conversion, as the app builds it.
const clean = {
  file: "CI 1146402.pdf", xlsxName: "CI_3583511.xlsx",
  qty: 291, total: 3304.16, expectedQty: 291, expectedTotal: 3304.16,
  lineCount: 25, currency: "EUR",
  checked: true, qtyChecked: true, totalChecked: true, qtyOk: true, totalOk: true,
  endTotalOk: true, isPartial: false, degraded: false,
  noWeightCount: 0, noWeightItems: [], unparsedCount: 0, unparsedItemNos: [],
  missedRows: [], blob: null,
};

// Each case is a real state, described by what makes it awkward.
const CASES = [
  ["een schone conversie",            clean],
  ["onvolledig: aantal wijkt af",     { ...clean, isPartial: true, qtyOk: false, qty: 288, expectedQty: 291 }],
  ["onvolledig: bedrag wijkt af",     { ...clean, isPartial: true, totalOk: false, total: 3300, expectedTotal: 3304.16 }],
  ["onvolledig: eindtotaal wijkt af", { ...clean, isPartial: true, endTotalOk: false }],
  ["regels ontbreken",                { ...clean, unparsedCount: 2, unparsedItemNos: ["1150056", "N04100"],
                                        missedRows: [{ itemNo: "1150056", reason: "geen regeltotaal", context: "…" }] }],
  ["brutogewicht ontbreekt",          { ...clean, noWeightCount: 4, noWeightItems: ["2500055", "2500056"] }],
  ["controlegegevens onleesbaar",     { ...clean, degraded: true }],
  ["niet gecontroleerd",              { ...clean, checked: false, expectedQty: null, expectedTotal: null }],
  ["geen controlegegevens",           { ...clean, qty: 0, checked: false }],
  ["een fout",                        { ...clean, error: "PDF kon niet worden gelezen" }],
  // The shapes that broke things before: a result with fields missing entirely, as an older
  // bundle or a partial response would produce.
  ["een resultaat met lege velden",   { file: "x.pdf", xlsxName: "x.xlsx", qty: 1, total: 1 }],
];

console.log("\n  SingleDoneState met elk resultaat dat de app maakt");
for (const [label, result] of CASES) {
  let html = "", err = null;
  try {
    html = render(React.createElement(app.SingleDoneState, {
      result, onReset: noop, onRedownload: noop, onForceDownload: noop, t: T,
    }));
  } catch (e) { err = e; }
  ok(label, !err, err ? `${err.constructor.name}: ${err.message}`.slice(0, 90) : `${html.length} tekens`);
}

console.log("\n  de waarschuwingen komen ook echt op het scherm");
{
  const html = render(React.createElement(app.ResultWarnings, {
    result: { ...clean, degraded: true, noWeightCount: 4, noWeightItems: ["2500055"],
              unparsedCount: 2, unparsedItemNos: ["1150056"] }, t: T }));
  // All three panels at once — the state that used to render none of them, because two had
  // no caller and the third had been deleted.
  ok("de onleesbare-controlegegevens-melding staat er", html.includes("controlegegevens"));
  ok("de ontbrekende-regels-melding staat er",          html.includes("itemnummer"));
  ok("de gewichtsmelding staat er",                     html.includes("brutogewicht"));
  ok("en de artikelnummers worden genoemd",             html.includes("1150056"));
}

console.log("\n  een schone conversie toont géén waarschuwingen");
{
  const html = render(React.createElement(app.ResultWarnings, { result: clean, t: T }));
  ok("niets over gewicht",      !html.includes("brutogewicht"));
  ok("niets over ontbrekende regels", !html.includes("itemnummer"));
  ok("leeg paneel",             html.length < 40, `${html.length} tekens`);
}

console.log("\n  BatchDoneState en BatchMissingItems");
{
  // The batch lists the workbook names it produced, not the source PDFs — so each row needs
  // its own xlsxName or the assertion below proves nothing.
  const rows = [
    { ...clean, file: "a.pdf", xlsxName: "CI_1.xlsx" },
    { ...clean, file: "b.pdf", xlsxName: "CI_2.xlsx", isPartial: true, qtyOk: false, qty: 10, expectedQty: 12 },
    { ...clean, file: "c.pdf", xlsxName: "CI_3.xlsx", error: "kapot" },
    { ...clean, file: "d.pdf", xlsxName: "CI_4.xlsx", unparsedCount: 1, unparsedItemNos: ["1150056"] },
  ];
  let err = null, html = "";
  try {
    html = render(React.createElement(app.BatchDoneState, {
      results: rows, successCount: 1, errorCount: 1, partialCount: 1,
      onDownloadZip: noop, onDownloadSingle: noop, onForceDownload: noop, onReset: noop, t: T,
    }));
  } catch (e) { err = e; }
  ok("een gemengde batch rendert", !err, err ? `${err.constructor.name}: ${err.message}`.slice(0, 90) : `${html.length} tekens`);
  ok("elke werkmap heeft zijn eigen rij",
     ["CI_1.xlsx", "CI_2.xlsx", "CI_3.xlsx", "CI_4.xlsx"].every(f => html.includes(f)));
  // The currency was hardcoded "CHF" in five visible strings while the API had been sending
  // X-Currency all along and the client ignored it. Most of the corpus is EUR.
  ok("de batchrij noemt de valuta van de factuur", html.includes("EUR"));
  ok("en zegt nergens meer CHF",                  !html.includes("CHF"), html.includes("CHF") ? "CHF staat er nog" : "");

  let err2 = null;
  try {
    render(React.createElement(app.BatchMissingItems, { result: rows[3], t: T }));
  } catch (e) { err2 = e; }
  ok("BatchMissingItems rendert", !err2, err2 ? String(err2.message).slice(0, 80) : "");
}

console.log("\n  een leeg resultaat mag niet omvallen");
for (const [label, result] of [["null", null], ["undefined", undefined], ["leeg object", {}]]) {
  let err = null;
  try { render(React.createElement(app.ResultWarnings, { result, t: T })); } catch (e) { err = e; }
  ok(`ResultWarnings met ${label}`, !err, err ? String(err.message).slice(0, 80) : "");
}

console.log("\n  de valuta komt van de factuur, niet uit een vaste tekst");
{
  for (const cur of ["EUR", "CHF", "GBP"]) {
    const html = render(React.createElement(app.SingleDoneState, {
      result: { ...clean, currency: cur }, onReset: noop, onRedownload: noop,
      onForceDownload: noop, t: T }));
    ok(`${cur} wordt genoemd`, html.includes(cur));
    for (const other of ["EUR", "CHF", "GBP"].filter(c => c !== cur)) {
      ok(`  en ${other} niet`, !html.includes(other));
    }
  }
  // No currency on the result — an older bundle, or a response without the header — falls
  // back rather than showing "undefined".
  const html = render(React.createElement(app.SingleDoneState, {
    result: { ...clean, currency: undefined }, onReset: noop, onRedownload: noop,
    onForceDownload: noop, t: T }));
  ok("zonder valuta valt hij terug op CHF", html.includes("CHF"));
  ok("en nergens 'undefined'",              !html.includes("undefined"));
}

console.log("\n  de reden van een overgeslagen regel wordt vertaald, niet doorgegeven");
{
  // The reader emits stable English keys. They used to be Dutch, so the lookup never hit and
  // the raw string showed through — invisible in Dutch, wrong in English.
  for (const [locale, key, want] of [
    ["NL", "no tariff number",   "tariefnummer niet gevonden"],
    ["NL", "no quantity",        "aantal niet gevonden"],
    ["NL", "no line total",      "regeltotaal niet gevonden"],
    ["NL", "fractional quantity","aantal is geen heel getal"],
    ["EN", "no tariff number",   "tariff number not found"],
    ["EN", "fractional quantity","quantity is not a whole number"],
  ]) {
    ok(`${locale}: ${key}`, app.i18n[locale].missedReasons[key] === want,
       app.i18n[locale].missedReasons[key] ?? "(ontbreekt)");
  }
}


console.log("\n  het lijstje 'nog te doen'");
{
  // The converter already knows all of this; it just never said it. Two entries always, the
  // third only when the invoice states no per-line weights.
  const plain = render(React.createElement(app.SingleDoneState, {
    result: clean, onReset: noop, onRedownload: noop, onForceDownload: noop, t: T }));
  ok("staat op een schone conversie",       plain.includes(T.todoTitle));
  ok("noemt rij 13",                        plain.includes("rij 13"));
  ok("noemt de Difference-rij",             plain.includes("Difference"));
  ok("geen regelgewichten als die er zijn", !plain.includes("kolom G"));

  const noWeight = render(React.createElement(app.SingleDoneState, {
    result: { ...clean, noWeightCount: 4, noWeightItems: ["2500055", "2500056"] },
    onReset: noop, onRedownload: noop, onForceDownload: noop, t: T }));
  ok("noemt de ontbrekende regelgewichten", noWeight.includes("kolom G"));
  ok("met het aantal erbij",                noWeight.includes("4 regels"));
  ok("en de artikelnummers",                noWeight.includes("2500055"));

  // A rejected conversion has no workbook to complete, so no checklist.
  const failed = render(React.createElement(app.SingleDoneState, {
    result: { ...clean, error: "kapot" }, onReset: noop, onRedownload: noop,
    onForceDownload: noop, t: T }));
  ok("niet bij een fout", !failed.includes(T.todoTitle));

  // Both locales have every string the component reaches for.
  for (const loc of ["NL", "EN"]) {
    const L2 = app.i18n[loc];
    ok(`${loc} heeft alle teksten`,
       typeof L2.todoTitle === "string" && typeof L2.todoGrossRow === "string"
       && typeof L2.todoDifference === "string" && typeof L2.todoLineWeights === "function");
  }
}

fs.rmSync(out, { force: true });

console.log("\n  de melding aan de gebruiker liegt niet");
{
  const base = { ...clean, isPartial: true, qtyOk: false, qty: 288, expectedQty: 291 };
  const withProp = (reported) => render(React.createElement(app.SingleDoneState, {
    result: base, onReset: noop, onRedownload: noop, onForceDownload: noop, reported, t: T }));

  ok("gemeld → zegt dat het gemeld is",   withProp(true).includes(T.reportedSent));
  ok("niet gemeld → zegt dát ook",        withProp(false).includes(T.reportedFailed));
  ok("en dan niet 'gemeld'",             !withProp(false).includes(T.reportedSent));
  // null means there was nothing to report, or it is not known yet. Saying nothing is the
  // only honest option there.
  ok("onbekend → zwijgt",                !withProp(null).includes(T.reportedSent)
                                      && !withProp(null).includes(T.reportedFailed));
  ok("prop afwezig → zwijgt ook",
     !render(React.createElement(app.SingleDoneState, { result: base, onReset: noop,
       onRedownload: noop, onForceDownload: noop, t: T })).includes(T.reportedSent));

  for (const loc of ["NL", "EN"]) {
    const L2 = app.i18n[loc];
    ok(`${loc} heeft beide teksten`,
       typeof L2.reportedSent === "string" && typeof L2.reportedFailed === "string");
  }
}

fs.rmSync(out, { force: true });
console.log(`
${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
