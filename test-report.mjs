// Tests the failure report.
//
// Two properties matter more than the rest, and both are about not crying wolf:
//
//   It must stay quiet for normal use. A packing list, a credit note or an oversized file is
//   the tool working as intended on input it cannot take, and the person in front of it can
//   act on all three. A mailbox full of those trains the reader to ignore the one that
//   matters.
//
//   It must never claim to have reported something it did not. The screen tells the user
//   they can stop worrying about it; that has to be true when it says it.
//
// Run: node test-report.mjs

import handler, { REPORTABLE, compose } from "./api/convert-report.js";

let pass = 0, fail = 0;
const ok = (label, cond, detail = "") => {
  console.log(`    ${cond ? "ok  " : "FAIL"} ${label}${detail ? "   " + detail : ""}`);
  cond ? pass++ : fail++;
};

function mockRes() {
  const r = { statusCode: 200, body: null, headers: {},
    setHeader(k, v) { r.headers[k.toLowerCase()] = v; return r; },
    status(c) { r.statusCode = c; return r; },
    json(o) { r.body = o; return r; },
    end() { return r; } };
  return r;
}
const call = async (body, method = "POST") => {
  const res = mockRes();
  await handler({ method, headers: {}, body }, res);
  return res;
};

const F = (kind, extra = {}) => ({ name: "CI 1146402.pdf", kind, ...extra });

console.log("\n  wat wel en niet gemeld wordt");
{
  // The kinds the converter emits, and whether the maintainer should hear about them.
  for (const kind of ["validation", "unknown-template", "crash", "excel-failed"]) {
    ok(`${kind} is meldenswaard`, REPORTABLE.has(kind));
  }
  for (const kind of ["no-items", "credit-note", "too-much-text", "unreadable"]) {
    ok(`${kind} is dat niet`, !REPORTABLE.has(kind));
  }
}

console.log("\n  normaal gebruik levert geen melding op");
for (const kind of ["no-items", "credit-note", "too-much-text", "unreadable"]) {
  const res = await call({ failures: [F(kind)] });
  ok(`${kind} → niets verstuurd`, res.statusCode === 200 && res.body.reported === false,
     JSON.stringify(res.body));
  ok(`  en de reden is expliciet`, res.body.reason === "nothing-reportable", String(res.body.reason));
}

console.log("\n  een batch met van alles erin meldt alleen het meldenswaardige");
{
  const res = await call({ failures: [
    F("no-items",        { name: "packinglist.pdf" }),
    F("credit-note",     { name: "creditnota.pdf" }),
    F("validation",      { name: "echt-fout.pdf", qty: 288, expectedQty: 291 }),
    F("unknown-template",{ name: "ander-sjabloon.pdf", missingColumns: ["tariffNo"] }),
  ], context: { total: 20 } });
  // No key configured in the test environment, so nothing goes out — but the count says what
  // it would have sent, and that is the filtering under test.
  ok("twee van de vier", res.body.count === 2, String(res.body.count));
  ok("niets verstuurd zonder sleutel", res.body.reported === false, JSON.stringify(res.body));
  ok("en het zegt waarom", res.body.reason === "not-configured", String(res.body.reason));
}

console.log("\n  het bericht zelf");
{
  const one = compose([F("validation", { qty: 288, expectedQty: 291, total: 3300,
    expectedTotal: 3304.16, unparsedItemNos: ["1150056", "N04100"] })], { total: 1 });
  ok("onderwerp noemt de soort en het bestand",
     one.subject.includes("validation") && one.subject.includes("CI 1146402.pdf"), one.subject);
  ok("de cijfers staan erin",       one.body.includes("288") && one.body.includes("291"));
  ok("de onleesbare regels ook",    one.body.includes("1150056"));
  ok("en wat de gebruiker te horen kreeg", one.body.includes("gemeld"));

  const many = compose([F("validation", { name: "a.pdf" }), F("crash", { name: "b.pdf" })],
                       { total: 20 });
  ok("bij meerdere staat het aantal in het onderwerp", many.subject.includes("2"), many.subject);
  ok("en de batchgrootte in de tekst",                 many.body.includes("20"));
  ok("beide bestanden worden genoemd",
     many.body.includes("a.pdf") && many.body.includes("b.pdf"));
}

console.log("\n  het bericht draagt geen factuurinhoud");
{
  // Filenames carry customer names and that is deliberate — the report goes to an internal
  // address and the name is what makes it findable. What must not travel is the document.
  const m = compose([F("validation", { name: "CI Klantnaam 123.pdf",
    unparsedItemNos: ["1150056"] })], { total: 1 });
  ok("geen base64", !/[A-Za-z0-9+/]{200,}/.test(m.body));
  ok("geen bedragen uit regels die niemand vroeg", !m.body.includes("O'NEILL"));
}

console.log("\n  de bewaking van het eindpunt");
{
  ok("GET wordt geweigerd",        (await call({}, "GET")).statusCode === 405);
  ok("OPTIONS is een preflight",   (await call({}, "OPTIONS")).statusCode === 204);
  ok("zonder failures: 400",       (await call({}).then(r => r.statusCode)) === 400);
  ok("failures moet een lijst zijn", (await call({ failures: "nee" })).statusCode === 400);
  const empty = await call({ failures: [] });
  ok("een lege lijst is geen fout", empty.statusCode === 200 && empty.body.reported === false);
}

console.log("\n  een rommelige melding brengt het eindpunt niet omver");
for (const [label, failures] of [
  ["null in de lijst",        [null]],
  ["geen kind",               [{ name: "x.pdf" }]],
  ["onbekend kind",           [F("iets-nieuws")]],
  ["velden van het verkeerde type", [F("validation", { qty: "veel", unparsedItemNos: "nee" })]],
]) {
  let threw = null, res = null;
  try { res = await call({ failures }); } catch (e) { threw = e; }
  ok(label, !threw && res.statusCode === 200, threw ? String(threw.message).slice(0, 60) : "");
}

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
