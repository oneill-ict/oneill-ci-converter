// Ground truth for every distinct DDP address block in the training corpus, plus
// the lines that must NOT be read as a city.
import { findCity } from "./lib/invoice-address.mjs";

let pass = 0, fail = 0;
const eq = (lines, want, note = "") => {
  const got = findCity(lines);
  const ok = got === want;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${JSON.stringify(lines.slice(-2)).padEnd(52)} -> ${String(got)}${ok ? "" : `   (verwacht ${want})`}${note ? "  " + note : ""}`);
  ok ? pass++ : fail++;
};

console.log("elk onderscheiden DDP-adres uit het corpus");
eq(["Altgraben 5", "4624 Härkingen", "Switzerland"], "Härkingen");
eq(["Oosteinde 32", "2361 HE Warmond", "The Netherlands"], "Warmond");
eq(["Oosteinde 32", "2361 HEWarmond", "The Netherlands"], "Warmond", "zonder spatie");
eq(["Qawra Sea Front (c/w Triq Nawciera)", "SPB1783 QAWRA-St'Pauls Bay", "Malta"], "QAWRA-St'Pauls Bay");
eq(["The Promenade", "EIRE Clare", "Ireland"], "Clare");
eq(["The Promenade", "EIREClare", "Ireland"], "Clare", "zonder spatie");
eq(["Spiller's Lane", "EIRECork", "Ireland"], "Cork");
eq(["73 Clarendon Road", "WD17 1TXWatford", "Ireland"], "Watford");
eq(["Route de la villaise Wispa", "JE32AP Saint Ouen", "United Kingdom"], "Saint Ouen");
eq(["Morriscastle none", "Y25 Y6T7 Kilmuckridge, Co Wexford", "Ireland"], "Kilmuckridge");
eq(["Morriscastle none", "Y25 Y6T7Kilmuckridge, Co Wexford", "Ireland"], "Kilmuckridge", "zonder spatie");
eq(["LISLET CROSSROADS, Les Tracheries", "Road FFR2+3M9", "GY2 4SP Saint Sampson", "Guernsey"], "Saint Sampson");
eq(["Carbury Coast Apt 5", "F91PN14Tullaghan", "Ireland"], "Tullaghan");
eq(["Østbrenne 10", "1339Vøyenenga", "Norway"], "Vøyenenga");
eq(["Kamehameha Hwy 61-258", "HI 96712 Haleiwa", "USA"], "Haleiwa");
eq(["rue jacques-Giroux 14", "G0A 4S0Saint-Gabriel-De-Valcartier, Q", "Canada"], "Saint-Gabriel-De-Valcartier");
eq(["100 rue Murray unit #1115", "QC H3C 1A2Montreal", "Canada"], "Montreal", "was 'rue'");
eq(["100 rue Murray unit #1115", "QC H3C 1A2 Montreal", "Canada"], "Montreal", "was 'rue'");
eq(["Luiseno Ave Oceanside 254", "Ca 92057California", "USA"], "California");
eq(["Bahnhofstrasse 1", "CH-4303 Kaiseraugst", "Switzerland"], "Kaiseraugst");

console.log("\nregels die geen stad zijn");
eq(["100 rue Murray unit #1115"], null, "huisnummer, geen postcode");
eq(["The Promenade", "Ireland"], null);
eq(["Morriscastle none"], null);
eq(["Attn. Finance Department"], null);
eq(["Kamehameha Hwy 61-258"], null);
eq([], null);
eq([""], null);
eq(["4624"], null, "postcode zonder plaats");

console.log(`\n${pass} geslaagd, ${fail} gefaald`);
process.exit(fail ? 1 : 0);
