// Finds the destination city in a billing address, for the "DDP <city>" delivery
// term the invoice needs.
//
// This replaces one regex that tried to cover every country at once:
//
//   /(?:[A-Z]{2}-\d{3,5}|\d{3,5}(?:\s+[A-Z]{2})?)\s+([A-Za-züöäÜÖÄ][A-Za-züöäÜÖÄ\-]+)/
//
// Measured over the 28 DDP invoices in the corpus, it found no city on 19 of them
// and the wrong city on 3 more:
//
//   "100 rue Murray unit #1115"   -> "rue"          (a house number and a street)
//   "2361 HEWarmond"              -> "HEWarmond"    (Dutch postcode letters kept)
//   "SPB1783 QAWRA-St'Pauls Bay"  -> "QAWRA-St"     (cut at the apostrophe)
//
// "DDP rue" is what shipped. The cause is that it only understood numeric
// continental postcodes, so Irish eircodes, UK and Crown Dependency codes,
// Canadian codes and Maltese codes all fell through — and where it did match, it
// matched anywhere in the line rather than at the start, which is how a street
// number became a postcode.
//
// So each postcode format is recognised explicitly, anchored at the start of the
// line, and the city is whatever follows it. When no line starts with a postcode
// we recognise, no city is returned and the delivery term stays a plain "DDP".
// A blank is a gap someone can fill; a wrong city on a customs document is not.

// An optional province or state code before the postcode: "QC H3C 1A2",
// "HI 96712", "Ca 92057".
const REGION = String.raw`(?:[A-Za-z]{2}\s+)?`;

// Ordered: a longer format has to be tried before a shorter one it contains, or
// the shorter one wins and leaves part of the postcode glued to the city.
// "2361 HE Warmond" must not be read by the bare-digits rule as city "HE".
const POSTCODES = [
  // Netherlands: 4 digits + 2 letters, with or without the space that the PDF
  // sometimes drops ("2361 HEWarmond").
  String.raw`\d{4}\s*[A-Z]{2}`,
  // Switzerland and similar, written with the country prefix: "CH-4303".
  String.raw`[A-Z]{2}-\d{3,5}`,
  // Ireland, eircode: routing key plus four characters — "Y25 Y6T7", "F91PN14".
  String.raw`[A-Z]\d{2}\s*[A-Z0-9]{4}`,
  // Canada: "G0A 4S0", "H3C 1A2".
  String.raw`[A-Z]\d[A-Z]\s*\d[A-Z]\d`,
  // United Kingdom and Crown Dependencies: "WD17 1TX", "GY2 4SP", "JE32AP".
  String.raw`[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}`,
  // Malta: "SPB1783".
  String.raw`[A-Z]{3}\d{4}`,
  // United States: five digits, normally behind a state code.
  String.raw`\d{5}`,
  // Ireland again, where the invoice writes the country instead of a postcode:
  // "EIRE Clare", "EIRECork".
  String.raw`EIRE`,
  // Norway, Switzerland, Germany and the rest: a bare 4-5 digit postcode. Last,
  // so it cannot claim the leading digits of a longer format. Four digits
  // minimum keeps a house number ("100 rue Murray") from qualifying.
  String.raw`\d{4,5}`,
];

// A city name: letters including accented ones, plus the spaces, hyphens and
// apostrophes that real names carry ("Saint-Gabriel-De-Valcartier",
// "QAWRA-St'Pauls Bay", "Saint Sampson"). Stops at a comma, which is where the
// county or province begins ("Kilmuckridge, Co Wexford").
const CITY = String.raw`([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*(?:[ ][A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'\-]*)*)`;

const PATTERNS = POSTCODES.map(pc =>
  new RegExp(`^${REGION}(?:${pc})\\s*${CITY}\\s*(?:,|$)`)
);

/**
 * Returns the destination city, or null when no address line starts with a
 * postcode format we recognise.
 */
export function findCity(addressLines) {
  for (const raw of addressLines || []) {
    const line = String(raw || "").trim();
    if (!line) continue;
    for (const re of PATTERNS) {
      const m = re.exec(line);
      // Two characters minimum: a single letter left over is a postcode remnant,
      // not a city.
      if (m && m[1] && m[1].trim().length >= 2) return m[1].trim();
    }
  }
  return null;
}
