// Tests for the logic that decides whether the user may trust an export.
//
// Until now every assertion in this repository was about the server. But the parser
// being right is only half of it: what protects the user is the app correctly saying
// "do not trust this one". That half — the badge colour, the reason on a batch row, the
// marker in the filename — had no tests at all, in an app whose entire history is
// about silent wrongness. A regression in trustOf would show a green badge on a bad
// conversion and nothing would notice.
//
// Run: node test-trust.mjs

import {
  TRUST_ORDER, trustOf, rowAxis, rowTotal, exportNameFor, httpErrorMessage,
} from "./src/lib/trust.js";

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = Object.is(got, want);
  console.log(`    ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `   got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// A result the app considers clean. Every case below is this, with one thing changed,
// so a test can never pass because two problems cancelled out.
const clean = () => ({
  xlsxName: "CI_4442960.xlsx",
  qty: 291, total: 3304.16,
  checked: true, qtyOk: true, totalOk: true,
  isPartial: false, degraded: false,
  noWeightCount: 0, uncertainCount: 0, unparsedCount: 0,
});

const t = {
  trustSuffix: {
    partial: "(ONVOLLEDIG)", unchecked: "(NIET GECONTROLEERD)",
    noweight: "(GEWICHT ONTBREEKT)", uncertain: "(AANTAL GESCHAT)",
    gaps: "(REGELS ONTBREKEN)", degraded: "(NIET GECONTROLEERD)",
    nodata: "(NIET GECONTROLEERD)",
  },
  errTooLarge: "te groot", errTimeout: "duurde te lang", errBusy: "te druk",
  errServer: "serverfout", errHttp: (s) => `HTTP ${s}`,
};

console.log("\n  een schone conversie");
eq("is ok",            trustOf(clean()).ok,   true);
eq("soort is ok",      trustOf(clean()).kind, "ok");
eq("naam blijft heel", exportNameFor(clean(), t), "CI_4442960.xlsx");

console.log("\n  elke reden om te wantrouwen");
const CASES = [
  ["error",     { error: "kapot" }],
  ["partial",   { isPartial: true }],
  ["unchecked", { checked: false }],
  ["noweight",  { noWeightCount: 4 }],
  ["uncertain", { uncertainCount: 2 }],
  ["gaps",      { unparsedCount: 3 }],
  ["degraded",  { degraded: true }],
  ["nodata",    { qty: 0 }],
];
for (const [kind, patch] of CASES) {
  const r = { ...clean(), ...patch };
  eq(`${kind} wordt niet vertrouwd`, trustOf(r).ok, false);
  eq(`${kind} heet ${kind}`,         trustOf(r).kind, kind);
}

console.log("\n  geen enkele reden ontbreekt in de legenda");
// A kind that trustOf can return but TRUST_ORDER does not list gets no legend entry
// and no filename marker, so it would look like a clean export.
for (const [kind] of CASES) {
  eq(`${kind} staat in TRUST_ORDER`, TRUST_ORDER.includes(kind), true);
}
eq("de legenda bevat niets extra", TRUST_ORDER.length, CASES.length);

console.log("\n  de reden staat in de bestandsnaam, want het bestand overleeft het scherm");
for (const [kind, patch] of CASES) {
  const name = exportNameFor({ ...clean(), ...patch }, t);
  if (kind === "error") {
    // A failed conversion has no workbook to name.
    eq("error krijgt geen achtervoegsel", name, "CI_4442960.xlsx");
    continue;
  }
  eq(`${kind} draagt zijn label`, name, `CI_4442960 ${t.trustSuffix[kind]}.xlsx`);
  eq(`${kind} houdt de extensie`, name.endsWith(".xlsx"), true);
  eq(`${kind} heeft er maar een`, (name.match(/\.xlsx/gi) || []).length, 1);
}

console.log("\n  ernst gaat voor: twee problemen noemen het zwaarste");
{
  // The order in TRUST_ORDER is the order of the checks. If a lighter reason won, the
  // user would be told about a missing weight while lines were actually missing.
  const both = { ...clean(), isPartial: true, noWeightCount: 4, unparsedCount: 3 };
  eq("onvolledig gaat voor gewicht en gaten", trustOf(both).kind, "partial");
  const later = { ...clean(), noWeightCount: 4, unparsedCount: 3 };
  eq("gewicht gaat voor gaten", trustOf(later).kind, "noweight");
  const lightest = { ...clean(), unparsedCount: 3, degraded: true };
  eq("gaten gaan voor onleesbare diagnose", trustOf(lightest).kind, "gaps");
}

console.log("\n  onbekende toestand is nooit stil goed");
eq("undefined is een fout",        trustOf(undefined).kind, "error");
eq("null is een fout",             trustOf(null).kind,      "error");
eq("een leeg object is geen ok",   trustOf({}).ok,           false);
// An empty object means no validation headers arrived at all.
eq("een leeg object is nodata",    trustOf({}).kind,        "nodata");
{
  // A newer server sending a flag this bundle does not know must not read as clean by
  // omission: the known flags still decide, and an unknown one cannot make it green.
  const r = { ...clean(), somethingNew: true };
  eq("een onbekend veld verandert niets", trustOf(r).kind, "ok");
}

console.log("\n  welke controle faalde");
eq("aantal",                  rowAxis({ qtyOk: false, totalOk: true }),  "qty");
eq("totaal",                  rowAxis({ qtyOk: true, totalOk: false }),  "total");
eq("aantal gaat voor totaal",  rowAxis({ qtyOk: false, totalOk: false }), "qty");
eq("beide vlaggen weg = onbekend", rowAxis({}), "unknown");
// A stale bundle against a newer server: one flag present, one missing.
eq("een vlag aanwezig, geen fout", rowAxis({ qtyOk: true }), "qty");

console.log("\n  het genoemde bedrag is dat van de werkmap");
{
  // Quoting the parsed figure meant naming a number that appears in no delivered file.
  const r = { total: 3304.16, parsedTotal: 3304.04, qtyOk: false, totalOk: false };
  eq("altijd het werkmaptotaal", rowTotal(r), 3304.16);
}

console.log("\n  platformfouten krijgen leesbare taal");
eq("413", httpErrorMessage(413, t), "te groot");
eq("504", httpErrorMessage(504, t), "duurde te lang");
eq("502", httpErrorMessage(502, t), "duurde te lang");
eq("429", httpErrorMessage(429, t), "te druk");
eq("500", httpErrorMessage(500, t), "serverfout");
eq("503", httpErrorMessage(503, t), "serverfout");
// Anything else still says something, rather than falling through to a bare code.
eq("400 valt terug op de code", httpErrorMessage(400, t), "HTTP 400");
eq("418 valt terug op de code", httpErrorMessage(418, t), "HTTP 418");


console.log("\n  de derde as: het eindtotaal");
{
  // Added because nothing compared the workbook's end total with the printed one, which is
  // how fifteen invoice discounts and two shipping-cost lines vanished behind a green check.
  eq("eindtotaal fout", rowAxis({ qtyOk: true, totalOk: true, endTotalOk: false }), "endTotal");
  // Ordered last: the other two point at a specific line, this one says a component of the
  // summary block was misread.
  eq("aantal gaat voor eindtotaal", rowAxis({ qtyOk: false, totalOk: true, endTotalOk: false }), "qty");
  eq("totaal gaat voor eindtotaal", rowAxis({ qtyOk: true, totalOk: false, endTotalOk: false }), "total");
  eq("alles goed blijft qty", rowAxis({ qtyOk: true, totalOk: true, endTotalOk: true }), "qty");
  // A bundle that predates the flag must not read a missing field as a failure.
  eq("veld afwezig is geen fout", rowAxis({ qtyOk: true, totalOk: true }), "qty");
}

console.log(`
${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
