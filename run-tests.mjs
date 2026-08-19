// Runs every tracked test in the repository root.
//
// The list comes from `git ls-files` rather than a plain glob or a hand-kept array.
// A glob would pick up the scratch files that accumulate beside real tests — this
// directory has held a dozen of them, including one that printed "SELF-VALIDATED —
// safe to push" while exercising a parser that no longer shipped. A hand-kept array
// drifts the moment someone adds a test and forgets to register it. What git tracks
// is exactly what ships, so that is the list.
//
// Tests that need the invoice corpus skip themselves when it is absent, so this same
// command is what CI runs and what runs locally. Two commands would drift the way
// the duplicated parser did.

import { spawnSync, execSync } from "node:child_process";

// A skipping test writes this at the start of a line and exits 0. An exact sentinel,
// not a word looked for anywhere in the output: matching loosely reported
// test-fixtures.mjs as skipped because one of its own assertions is labelled
// "overgeslagen regels", and a test that stalled could have passed itself off as
// skipped the same way.
const SKIP_MARK = "SKIP:";

const files = execSync("git ls-files test-*.mjs compare-*.mjs", { encoding: "utf8" })
  .split("\n").map(s => s.trim()).filter(Boolean);

if (files.length === 0) {
  console.error("Geen tests gevonden — draait dit binnen een git-checkout?");
  process.exit(1);
}

console.log(`${files.length} testbestanden\n${"-".repeat(60)}`);

const failed = [];
const skipped = [];
for (const file of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const ms = Date.now() - t0;

  const skipLine = out.split("\n").find(l => l.trim().startsWith(SKIP_MARK));
  if (r.status === 0 && skipLine) {
    console.log(`  skip  ${file.padEnd(30)} ${skipLine.trim().slice(SKIP_MARK.length).trim()}`);
    skipped.push(file);
  } else if (r.status === 0) {
    console.log(`  ok    ${file.padEnd(30)} ${ms} ms`);
  } else {
    console.log(`  FAAL  ${file.padEnd(30)} exit ${r.status}`);
    // Only failures print their output, so a green run stays readable.
    console.log(out.split("\n").map(l => "        " + l).join("\n"));
    failed.push(file);
  }
}

console.log("-".repeat(60));
console.log(`${files.length - failed.length - skipped.length} geslaagd, ${failed.length} gefaald, ${skipped.length} overgeslagen`);
if (skipped.length) {
  console.log("\nOvergeslagen tests hebben het facturencorpus nodig. Dat staat niet in de\n" +
              "repository — het zijn echte klantfacturen met namen en adressen. Zet\n" +
              "CI_CORPUS_DIR naar de map om ze lokaal wel te draaien.");
}
process.exit(failed.length ? 1 : 0);
