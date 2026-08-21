// Reports a failed conversion to whoever maintains this converter.
//
// This exists because of how the project started: a colleague hit an error while Sjoerd was
// away, could not act on it, and did the invoice by hand. The message names the lines now,
// but a colleague alone still had nowhere to send it. So the app sends it, and tells them it
// has been sent, instead of leaving them to write an email about a stack of item numbers.
//
// Deliberately narrow about what counts as worth reporting. A packing list, a credit note or
// an oversized file is normal use — the person can act on those themselves and a mailbox
// full of them would train the reader to ignore it. What gets reported is the converter
// possibly being wrong: a validation mismatch, lines it could not read, a template it does
// not understand, or a crash.
//
// One report per batch, not per file. Twenty bad files in one drop is one message listing
// twenty, which is also the only way to see whether it is one problem or twenty.
//
// The path starts with /api/convert so the firewall's rate-limit rule covers it too.

// Failures the maintainer should hear about. Everything else is the tool working as intended
// on input it cannot take.
const REPORTABLE = new Set(["validation", "unknown-template", "crash", "excel-failed"]);

// Never let a report block or break a conversion: the workbook is already downloaded by the
// time this runs. Every failure here is swallowed and reported back as "not sent" so the
// screen can say something true rather than something reassuring.
const RECIPIENT = "sjoerd.lier@oneill.com";

// Resend's shared sender works without domain verification, and only to the account
// owner's own address — which is the recipient here. Sending from @oneill.com needs a DNS
// record; until then this is the honest default rather than a broken From.
const SENDER = process.env.REPORT_FROM || "onboarding@resend.dev";

const MAX_FILES = 40;

/** One line per failed file, in a form that is readable in a mail client. */
function describe(f) {
  const bits = [];
  if (f.kind)            bits.push(f.kind);
  if (f.qty != null && f.expectedQty != null && f.qty !== f.expectedQty) {
    bits.push(`aantal ${f.qty} tegen ${f.expectedQty}`);
  }
  if (f.total != null && f.expectedTotal != null) {
    bits.push(`totaal ${f.total} tegen ${f.expectedTotal}`);
  }
  // Array.isArray, not a truthy .length: a string has a length too, and a client sending
  // unparsedItemNos as a string got this far and then threw on .join. Nothing about a report
  // is worth a 500 — the conversion it describes has already finished.
  const list = (v) => (Array.isArray(v) ? v.filter(x => typeof x === "string" || typeof x === "number") : []);
  const cols = list(f.missingColumns);
  const nos  = list(f.unparsedItemNos);
  if (cols.length) bits.push(`kolommen ontbreken: ${cols.join(", ")}`);
  if (nos.length)  bits.push(`onleesbare regels: ${nos.slice(0, 12).join(", ")}`);
  if (f.error) bits.push(f.error);
  return `${f.name || "(naamloos)"}\n    ${bits.join("\n    ")}`;
}

function compose(failures, context) {
  const one = failures.length === 1;
  const subject = one
    ? `CI-converter: ${failures[0].kind} op ${failures[0].name || "een factuur"}`
    : `CI-converter: ${failures.length} facturen mislukt`;

  const body = [
    one ? "Een conversie is mislukt." : `${failures.length} conversies zijn mislukt.`,
    context?.total ? `Uit een batch van ${context.total} bestand(en).` : "",
    "",
    ...failures.map(describe),
    "",
    "De gebruiker heeft te horen gekregen dat dit gemeld is, dus die verwacht geen actie",
    "van zichzelf. Het Excel is niet afgeleverd — bij een validatiefout kan de gebruiker wel",
    "'Toch downloaden' kiezen, en dat bestand draagt de reden in zijn bestandsnaam.",
    "",
    context?.userAgent ? `Browser: ${context.userAgent}` : "",
  ].filter(Boolean).join("\n");

  return { subject, body };
}

async function send({ subject, body }) {
  const key = process.env.RESEND_API_KEY;
  // No key configured: the report is logged instead. Vercel's runtime logs keep it, and the
  // caller is told it was not sent so the screen does not claim otherwise.
  if (!key) {
    console.log(JSON.stringify({ event: "ci_report_unsent", reason: "no RESEND_API_KEY", subject }));
    return { sent: false, reason: "not-configured" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: SENDER, to: [RECIPIENT], subject, text: body }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.log(JSON.stringify({ event: "ci_report_failed", status: res.status,
                                   detail: detail.slice(0, 200) }));
      return { sent: false, reason: `http-${res.status}` };
    }
    console.log(JSON.stringify({ event: "ci_report_sent", subject }));
    return { sent: true };
  } catch (e) {
    console.log(JSON.stringify({ event: "ci_report_failed", error: e?.message }));
    return { sent: false, reason: "network" };
  }
}

const ALLOWED_ORIGINS = [
  "https://oneill-ci-converter-lemon.vercel.app",
  "http://localhost:5173",
];

export default async function handler(req, res) {
  const origin = req.headers?.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { failures, context } = req.body || {};
  if (!Array.isArray(failures)) {
    return res.status(400).json({ error: "Geen mislukte conversies meegestuurd" });
  }

  // Filter here rather than trusting the client to have filtered: this endpoint decides what
  // is worth a message, so the rule lives in one place and cannot drift with the frontend.
  const worth = failures
    .filter(f => f && REPORTABLE.has(f.kind))
    .slice(0, MAX_FILES);

  if (worth.length === 0) {
    return res.status(200).json({ reported: false, reason: "nothing-reportable" });
  }

  const result = await send(compose(worth, context));
  return res.status(200).json({
    reported: result.sent,
    reason: result.reason ?? null,
    count: worth.length,
  });
}

// Exported for the tests: what counts as reportable, and what the message says.
export { REPORTABLE, compose };
