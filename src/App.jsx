import React, { useState, useRef, useCallback, useEffect } from "react";
import { Upload, CheckCircle2, AlertCircle, Loader2, FileDown, Archive, AlertTriangle, Clock, Trash2 } from "lucide-react";
import JSZip from "jszip";
import { T } from "./lib/theme.js";

// ── Translations ─────────────────────────────────────────────────────────────
const i18n = {
  NL: {
    title:         "Commercial Invoice Converter",
    dragHere:      "Loslaten om te uploaden",
    uploadTitle:   "Upload Commercial Invoice PDF",
    uploadSub:     "Sleep een of meerdere PDF's hierheen of klik om te bladeren",
    chooseFile:    "Kies bestand(en)",
    uploadHint:    "Ondersteunde structuur: O'Neill Commercial Invoice",
    uploadHint2:   "Output: Excel (.xlsx) met tariefsubtotalen",
    processing:    "PDF wordt verwerkt…",
    processingOf:  (i, n) => `Bestand ${i} van ${n}`,
    processSub:    "Factuurregels extraheren en Excel opbouwen",
    downloadStart: "Download gestart",
    validOk:       "Validatie geslaagd",
    validUnchecked:"Niet gecontroleerd — factuurtotaal niet gevonden",
    validQtyOnly:  "Alleen aantal gecontroleerd — bedrag niet leesbaar",
    validTotalOnly:"Alleen bedrag gecontroleerd — aantal niet leesbaar",
    validRows:     (q, t) => `${q} stuks · CHF ${t}`,
    redownload:    "Opnieuw downloaden",
    newInvoice:    "Nieuwe factuur converteren",
    newInvoices:   "Nieuwe facturen",
    checkResults:  "Controleer de resultaten",
    mismatchTitle: "Aantal stuks komt niet overeen",
    mismatchFound: "Gevonden:",
    mismatchExp:   "Verwacht:",
    missedItemsLabel: "Ontbrekend in export",
    unreadableRows: (n) => n === 1
      ? "1 regel gevonden waarvan het artikelnummer niet leesbaar was — zie details."
      : `${n} regels gevonden waarvan het artikelnummer niet leesbaar was — zie details.`,
    missedDetailsLabel: "Reden per item",
    missedReasons: {
      "no tariff number":          "tariefnummer niet gevonden",
      "no tariff+gr":              "tariefnummer niet gevonden",
      "no item number in block":   "itemnummer niet herkend",
    },
    missedReasonDefault: (r) => r,
    downloadAnyway:"Download toch",
    failTitle:     "Verwerking mislukt",
    filesOf:       (s, n) => `${s} van ${n} bestanden verwerkt`,
    failedCount:   (n) => `${n} mislukt`,
    warnCount:     (n) => `${n} met waarschuwing`,
    downloadZip:   "Download alle als ZIP",
    // A mismatch fires when the quantity OR the amount is off, so a zero
    // quantity delta is reachable — "0 te veel" read as nonsense under a
    // heading about quantities not matching.
    shortBy:       (n) => n === 0 ? "aantal klopt" : n > 0 ? `${n} te weinig` : `${-n} te veel`,
    amountOff:     (d) => `bedrag ${d > 0 ? "te laag" : "te hoog"}: CHF ${fmtCHF(Math.abs(d))}`,
    forcedNote:    "Toch gedownload — dit bestand is niet goedgekeurd.",
    forceFailed:   (msg) => `Downloaden mislukt: ${msg}`,
    trustSuffix: {
      partial:   "(ONVOLLEDIG)",
      unchecked: "(NIET GECONTROLEERD)",
      drift:     "(BEDRAG WIJKT AF)",
      noweight:  "(GEWICHT ONTBREEKT)",
      uncertain: "(AANTAL GESCHAT)",
      gaps:      "(REGELS ONTBREKEN)",
      nodata:    "(NIET GECONTROLEERD)",
    },
    trustReason: {
      partial:   "aantal of totaal komt niet overeen met de factuur",
      unchecked: "het factuurtotaal kon niet worden gelezen",
      drift:     "het Excel telt niet op tot het bedrag op de factuur",
      noweight:  "bij een of meer regels ontbreekt het brutogewicht",
      uncertain: "bij een of meer regels is het aantal geschat",
      gaps:      "een of meer artikelnummers uit de PDF ontbreken",
      nodata:    "de controlegegevens zijn niet ontvangen",
    },
    zipReadmeName: "LEES-DIT-EERST.txt",
    zipReadmeBody: (names, legend) =>
      "LET OP\r\n\r\n" +
      "De volgende bestanden in deze ZIP zijn NIET goedgekeurd door de converter.\r\n" +
      "Controleer ze handmatig voordat je ze voor de douane gebruikt:\r\n\r\n" +
      names.map(n => "  - " + n).join("\r\n") + "\r\n\r\n" +
      legend + "\r\n",
    noPdfsFound:   (n) => n === 1
      ? "Dat bestand is geen PDF. Sleep een Commercial Invoice in PDF-formaat."
      : `Geen van die ${n} bestanden is een PDF. Sleep Commercial Invoices in PDF-formaat.`,
    skippedNonPdf: (n) => n === 1
      ? "1 bestand overgeslagen: geen PDF."
      : `${n} bestanden overgeslagen: geen PDF.`,
    recentTitle:   "Recent",
    clearHistory:  "Wissen",
    rows:          "stuks",
    justNow:       "zojuist",
    minAgo:        (n) => `${n} min geleden`,
    hourAgo:       (n) => `${n} uur geleden`,
    yesterday:     "gisteren",
    daysAgo:       (n) => `${n} dagen geleden`,
    previewTitle:  (n) => `Preview eerste ${n} regels`,
    previewMore:   (n, t) => `+ ${n} meer regels in het Excel-bestand`,
    colNr:         "Nr.", colItem: "Item", colColour: "Kleur",
    colQty:        "Qty", colPrice: "Prijs", colTotal: "Totaal",
    footer:        "PDF → XLSX · Geen login vereist · Geen data opgeslagen",
    download:      "Download",
    anyway:        "Toch",
    silentGapNote: (n) => `Let op: ${n} itemnummer(s) uit de PDF zijn niet in de export opgenomen —`,
    uncertainQtyNote: (n) => n === 1
      ? "Let op: bij 1 regel kon het aantal niet uit de factuur worden afgeleid — het getal in de export is een schatting. Controleer:"
      : `Let op: bij ${n} regels kon het aantal niet uit de factuur worden afgeleid — die getallen zijn een schatting. Controleer:`,
    driftNote: (n, excel, stated) =>
      `Let op: het Excel telt op tot CHF ${excel}, de factuur zegt CHF ${stated}. Dat komt door ${n} regel${n === 1 ? "" : "s"} waar aantal × prijs niet exact het regeltotaal oplevert:`,
  },
  EN: {
    title:         "Commercial Invoice Converter",
    dragHere:      "Drop to upload",
    uploadTitle:   "Upload Commercial Invoice PDF",
    uploadSub:     "Drag one or more PDFs here or click to browse",
    chooseFile:    "Choose file(s)",
    uploadHint:    "Supported format: O'Neill Commercial Invoice",
    uploadHint2:   "Output: Excel (.xlsx) with tariff subtotals",
    processing:    "Processing PDF…",
    processingOf:  (i, n) => `File ${i} of ${n}`,
    processSub:    "Extracting invoice lines and building Excel",
    downloadStart: "Download started",
    validOk:       "Validation passed",
    validUnchecked:"Not verified — invoice total not found",
    validQtyOnly:  "Only the quantity was verified — amount unreadable",
    validTotalOnly:"Only the amount was verified — quantity unreadable",
    validRows:     (q, t) => `${q} pieces · CHF ${t}`,
    redownload:    "Download again",
    newInvoice:    "Convert new invoice",
    newInvoices:   "New invoices",
    checkResults:  "Check the results",
    mismatchTitle: "Piece count mismatch",
    mismatchFound: "Found:",
    mismatchExp:   "Expected:",
    missedItemsLabel: "Missing from export",
    unreadableRows: (n) => n === 1
      ? "1 line was found whose item number could not be read — see details."
      : `${n} lines were found whose item numbers could not be read — see details.`,
    missedDetailsLabel: "Reason per item",
    missedReasons: {
      "no tariff number":          "tariff number not found",
      "no tariff+gr":              "tariff number not found",
      "no item number in block":   "item number not recognised",
    },
    missedReasonDefault: (r) => r,
    downloadAnyway:"Download anyway",
    failTitle:     "Processing failed",
    filesOf:       (s, n) => `${s} of ${n} files processed`,
    failedCount:   (n) => `${n} failed`,
    warnCount:     (n) => `${n} with warning`,
    downloadZip:   "Download all as ZIP",
    shortBy:       (n) => n === 0 ? "quantity matches" : n > 0 ? `${n} short` : `${-n} too many`,
    amountOff:     (d) => `amount ${d > 0 ? "too low" : "too high"}: CHF ${fmtCHF(Math.abs(d))}`,
    forcedNote:    "Downloaded anyway — this file is not approved.",
    forceFailed:   (msg) => `Download failed: ${msg}`,
    trustSuffix: {
      partial:   "(INCOMPLETE)",
      unchecked: "(NOT VERIFIED)",
      drift:     "(AMOUNT DIFFERS)",
      noweight:  "(WEIGHT MISSING)",
      uncertain: "(QUANTITY ESTIMATED)",
      gaps:      "(LINES MISSING)",
      nodata:    "(NOT VERIFIED)",
    },
    trustReason: {
      partial:   "quantity or total does not match the invoice",
      unchecked: "the invoice total could not be read",
      drift:     "the Excel does not add up to the amount on the invoice",
      noweight:  "the gross weight is missing on one or more lines",
      uncertain: "the quantity on one or more lines is an estimate",
      gaps:      "one or more item numbers from the PDF are missing",
      nodata:    "the validation data was not received",
    },
    zipReadmeName: "READ-ME-FIRST.txt",
    zipReadmeBody: (names, legend) =>
      "WARNING\r\n\r\n" +
      "The following files in this ZIP were NOT approved by the converter.\r\n" +
      "Check them by hand before using them for customs:\r\n\r\n" +
      names.map(n => "  - " + n).join("\r\n") + "\r\n\r\n" +
      legend + "\r\n",
    noPdfsFound:   (n) => n === 1
      ? "That file is not a PDF. Drop a Commercial Invoice in PDF format."
      : `None of those ${n} files is a PDF. Drop Commercial Invoices in PDF format.`,
    skippedNonPdf: (n) => n === 1
      ? "1 file skipped: not a PDF."
      : `${n} files skipped: not a PDF.`,
    recentTitle:   "Recent",
    clearHistory:  "Clear",
    rows:          "pieces",
    justNow:       "just now",
    minAgo:        (n) => `${n} min ago`,
    hourAgo:       (n) => `${n} hr ago`,
    yesterday:     "yesterday",
    daysAgo:       (n) => `${n} days ago`,
    previewTitle:  (n) => `Preview first ${n} rows`,
    previewMore:   (n) => `+ ${n} more rows in the Excel file`,
    colNr:         "No.", colItem: "Item", colColour: "Colour",
    colQty:        "Qty", colPrice: "Price", colTotal: "Total",
    footer:        "PDF → XLSX · No login required · No data stored",
    download:      "Download",
    anyway:        "Anyway",
    silentGapNote: (n) => `Note: ${n} item number(s) from the PDF were not included in the export —`,
    uncertainQtyNote: (n) => n === 1
      ? "Note: on 1 line the quantity could not be derived from the invoice — the number in the export is an estimate. Please check:"
      : `Note: on ${n} lines the quantity could not be derived from the invoice — those numbers are estimates. Please check:`,
    driftNote: (n, excel, stated) =>
      `Note: the Excel adds up to CHF ${excel}, the invoice says CHF ${stated}. This comes from ${n} line${n === 1 ? "" : "s"} where quantity × price does not reproduce the stated line total exactly:`,
  },
};

const Wave = () => (
  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 80, overflow: "hidden", pointerEvents: "none" }}>
    <div style={{ position: "absolute", bottom: 0, left: 0, width: "200%", animation: "waveScroll 24s linear infinite" }}>
      <svg width="100%" height="80" viewBox="0 0 2880 80" preserveAspectRatio="none">
        <path d="M0,40 C240,15 480,15 720,40 C960,65 1200,65 1440,40 C1680,15 1920,15 2160,40 C2400,65 2640,65 2880,40 L2880,80 L0,80 Z" fill="#0F3348" fillOpacity="0.55"/>
      </svg>
    </div>
    <div style={{ position: "absolute", bottom: 0, left: 0, width: "200%", animation: "waveScroll 18s linear infinite" }}>
      <svg width="100%" height="60" viewBox="0 0 2880 60" preserveAspectRatio="none">
        <path d="M0,35 C240,15 480,15 720,35 C960,55 1200,55 1440,35 C1680,15 1920,15 2160,35 C2400,55 2640,55 2880,35 L2880,60 L0,60 Z" fill="#1F6F66" fillOpacity="0.4"/>
      </svg>
    </div>
    <div style={{ position: "absolute", bottom: 0, left: 0, width: "200%", animation: "waveScroll 12s linear infinite" }}>
      <svg width="100%" height="40" viewBox="0 0 2880 40" preserveAspectRatio="none">
        <path d="M0,28 C60,28 120,13 180,13 C240,13 300,28 360,28 C420,28 480,43 540,43 C600,43 660,28 720,28 C780,28 840,13 900,13 C960,13 1020,28 1080,28 C1140,28 1200,43 1260,43 C1320,43 1380,28 1440,28 C1500,28 1560,13 1620,13 C1680,13 1740,28 1800,28 C1860,28 1920,43 1980,43 C2040,43 2100,28 2160,28 C2220,28 2280,13 2340,13 C2400,13 2460,28 2520,28 C2580,28 2640,43 2700,43 C2760,43 2820,28 2880,28 L2880,40 L0,40 Z" fill="#26B5A8" fillOpacity="0.2"/>
      </svg>
    </div>
  </div>
);

const fmtCHF = (n) =>
  Number(n).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── API call ────────────────────────────────────────────────────────────────

async function convertFile(file, force = false) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const res = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf: base64, filename: file.name, force }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    // Validation mismatch: expose structured data for the friendly warning UI
    if (res.status === 422 && err.parsedQty != null) {
      const e = new Error("validation_mismatch");
      e.isPartial        = true;
      e.parsedQty        = err.parsedQty;
      e.expectedQty      = err.expectedQty;
      e.parsedTotal      = err.parsedTotal;
      e.expectedTotal    = err.expectedTotal;
      e.missedRows       = err.missedRows       || [];
      e.unparsedItemNos  = err.unparsedItemNos  || [];
      throw e;
    }
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const qty              = parseInt(res.headers.get("X-Validation-Qty")    || "0", 10);
  const total            = parseFloat(res.headers.get("X-Validation-Total") || "0");
  // "1" only when BOTH axes were compared against the invoice footer.
  const checked          = res.headers.get("X-Validation-Checked") === "1";
  const qtyChecked       = res.headers.get("X-Validation-Qty-Checked")   === "1";
  const totalChecked     = res.headers.get("X-Validation-Total-Checked") === "1";
  // These headers are diagnostics. A malformed or truncated value must never
  // discard an otherwise good conversion, so parse failures degrade to empty.
  const parseHeader = (raw, decode) => {
    if (!raw) return [];
    try { return JSON.parse(decode ? decodeURIComponent(raw) : raw); }
    catch { return []; }
  };
  const preview          = parseHeader(res.headers.get("X-Preview"), true);
  const unparsedItemNos  = parseHeader(res.headers.get("X-Unparsed-Items"), false);
  // The list is capped server-side; the count is the true total.
  const unparsedCount    = parseInt(res.headers.get("X-Unparsed-Count") || "0", 10) || unparsedItemNos.length;
  const uncertainItems   = parseHeader(res.headers.get("X-Uncertain-Items"), false);
  const uncertainCount   = parseInt(res.headers.get("X-Uncertain-Count") || "0", 10) || uncertainItems.length;
  // The workbook's own total, which can differ from the line totals stated on
  // the invoice when a qty/price split does not reconcile exactly.
  const excelTotal       = parseFloat(res.headers.get("X-Excel-Total") || "0");
  const driftItems       = parseHeader(res.headers.get("X-Drift-Items"), false);
  const driftCount       = parseInt(res.headers.get("X-Drift-Count") || "0", 10) || driftItems.length;
  // Lines with no gross weight — a customs-declared field left blank.
  const noWeightItems    = parseHeader(res.headers.get("X-NoWeight-Items"), false);
  const noWeightCount    = parseInt(res.headers.get("X-NoWeight-Count") || "0", 10) || noWeightItems.length;
  // Invoice lines, as opposed to `qty` which is the total piece count.
  const lineCount        = parseInt(res.headers.get("X-Line-Count") || "0", 10);
  const blob             = await res.blob();
  return { blob, qty, total, checked, qtyChecked, totalChecked, lineCount, preview,
    unparsedItemNos, unparsedCount, uncertainItems, uncertainCount, excelTotal, driftItems, driftCount,
    noWeightItems, noWeightCount };
}

// ── App ─────────────────────────────────────────────────────────────────────

const HISTORY_KEY = "oneill_ci_history";
const MAX_HISTORY = 10;

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}
function saveHistory(entries) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY))); } catch {}
}

export default function App() {
  const [phase, setPhase]       = useState("idle");  // idle | processing | done
  const [progress, setProgress] = useState({ i: 0, total: 0, name: "" });
  const [results, setResults]   = useState([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice]     = useState(null);   // files dropped that were not PDFs
  const [history, setHistory]   = useState(loadHistory);
  const [lang, setLang]         = useState(() => localStorage.getItem("oneill_lang") || "NL");
  const t = i18n[lang];
  const toggleLang = () => {
    const next = lang === "NL" ? "EN" : "NL";
    setLang(next);
    localStorage.setItem("oneill_lang", next);
  };
  const inputRef = useRef(null);

  const runBatch = useCallback(async (files) => {
    // Files from network shares and mail clients often arrive with an empty
    // MIME type, so fall back to the extension. Previously those were dropped
    // without a word, and the "N of M processed" count hid the gap.
    const all     = [...files];
    const pdfs    = all.filter(f => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const skipped = all.length - pdfs.length;

    if (!pdfs.length) {
      // Return before setPhase left the previous result on screen, complete
      // with a live download button belonging to a different invoice.
      setResults([]);
      setPhase("idle");
      setNotice(t.noPdfsFound(all.length));
      return;
    }
    setNotice(skipped > 0 ? t.skippedNonPdf(skipped) : null);

    setPhase("processing");
    setResults([]);

    const batch = [];
    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      setProgress({ i: i + 1, total: pdfs.length, name: file.name });
      const xlsxName = file.name.replace(/\.[^.]+$/, "") + ".xlsx";

      try {
        const c = await convertFile(file);
        const row = { name: file.name, xlsxName, ...c,
          unparsedItemNos: c.unparsedItemNos || [], uncertainItems: c.uncertainItems || [],
          uncertainCount: c.uncertainCount || 0, driftItems: c.driftItems || [], driftCount: c.driftCount || 0,
          error: null, isPartial: false, file };
        // Single file: trigger immediate download, under the status-carrying name
        if (pdfs.length === 1) triggerDownload(row.blob, exportNameFor(row, t));
        batch.push(row);
      } catch (e) {
        if (e.isPartial) {
          // Validation mismatch — auto-download the export anyway so the team can continue,
          // then show the warning with details about what was missed.
          let autoBlob = null, autoPreview = [];
          const row = {
            name: file.name, xlsxName, blob: null,
            qty: e.parsedQty, total: e.parsedTotal,
            expectedQty: e.expectedQty, expectedTotal: e.expectedTotal,
            missedRows: e.missedRows || [],
            unparsedItemNos: e.unparsedItemNos || [],
            unparsedCount: (e.unparsedItemNos || []).length,
            uncertainItems: (e.uncertainLines || []).map(x => x.itemNo),
            uncertainCount: (e.uncertainLines || []).length,
            driftItems: (e.driftLines || []).map(x => x.itemNo),
            driftCount: (e.driftLines || []).length,
            excelTotal: e.excelTotal,
            preview: [], error: null, isPartial: true, file,
          };
          try {
            const forced = await convertFile(file, true);
            autoBlob    = forced.blob;
            autoPreview = forced.preview;
            row.blob = autoBlob; row.preview = autoPreview;
            // Auto-download carries the status in its name — this file lands in
            // the downloads folder before the warning has even rendered.
            if (pdfs.length === 1) triggerDownload(autoBlob, exportNameFor(row, t));
          } catch {}
          batch.push(row);
        } else {
          batch.push({ name: file.name, xlsxName, blob: null, qty: null, total: null, preview: [], error: e.message, isPartial: false, file });
        }
      }
    }

    setResults(batch);
    setPhase("done");

    // Persist only conversions that can be vouched for. The old filter allowed
    // unchecked and uncertain results through, and the history panel then drew
    // them with a green tick — with no `checked` field stored to correct it.
    const newEntries = batch
      .filter(r => trustOf(r).ok)
      .map(r => ({ name: r.xlsxName, qty: r.qty, total: r.total, ts: Date.now() }));
    if (newEntries.length) {
      setHistory(prev => {
        const updated = [...newEntries, ...prev].slice(0, MAX_HISTORY);
        saveHistory(updated);
        return updated;
      });
    }
  }, [t]);

  // Force-download a partial result. If blob is already stored (auto-downloaded), just re-trigger.
  const downloadForce = useCallback(async (r) => {
    if (r.blob) { triggerDownload(r.blob, exportNameFor(r, t)); return; }
    setResults(prev => prev.map(p => p === r ? { ...p, forceLoading: true } : p));
    try {
      const { blob, qty, total, preview } = await convertFile(r.file, true);
      // A forced export is unverified by definition — the totals did not
      // reconcile. Stay `isPartial` so the mismatch figures and the missing-item
      // list remain on screen; only the download state changes.
      const next = { ...r, blob, qty, total, preview, forcedAt: Date.now(), forceLoading: false };
      triggerDownload(blob, exportNameFor(next, t));
      setResults(prev => prev.map(p => p === r ? next : p));
    } catch (e) {
      // Keep isPartial so the mismatch detail is not wiped by a failed retry.
      setResults(prev => prev.map(p => p === r
        ? { ...p, forceError: e.message, forceLoading: false }
        : p));
    }
  }, [t]);

  const downloadSingle = (r) => triggerDownload(r.blob, exportNameFor(r, t));

  const downloadZip = async () => {
    const zip = new JSZip();
    // Once the ZIP leaves the browser the on-screen warning is gone, so an
    // export that cannot be vouched for has to carry its status in the filename.
    const flagged = [];
    for (const r of results) {
      if (!r.blob) continue;
      const name = exportNameFor(r, t);
      if (name !== r.xlsxName) flagged.push(name);
      zip.file(name, r.blob);
    }
    if (flagged.length) {
      // Only explain the markers actually present in this ZIP.
      const kinds  = [...new Set(results.filter(r => r.blob).map(r => trustOf(r).kind))]
        .filter(k => t.trustSuffix[k]);
      const legend = kinds
        .sort((a, b) => TRUST_ORDER.indexOf(a) - TRUST_ORDER.indexOf(b))
        .map(k => `${t.trustSuffix[k].padEnd(24)} = ${t.trustReason[k]}`)
        .join("\r\n");
      zip.file(t.zipReadmeName, t.zipReadmeBody(flagged, legend));
    }
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    triggerDownload(zipBlob, "commercial-invoices.zip");
  };

  const reset = () => { setPhase("idle"); setResults([]); setNotice(null); setProgress({ i: 0, total: 0, name: "" }); };
  const clearHistory = () => { saveHistory([]); setHistory([]); };

  const onFileChange = (e) => { if (e.target.files?.length) runBatch(e.target.files); e.target.value = ""; };
  const onDrop       = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) runBatch(e.dataTransfer.files); };
  const onDragOver   = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave  = () => setDragging(false);

  // Counted through the same predicate as everything else: "success" means an
  // export that can be vouched for, not merely one that did not throw.
  const successCount = results.filter(r => trustOf(r).ok).length;
  const errorCount   = results.filter(r => trustOf(r).kind === "error").length;
  const partialCount = results.filter(r => !trustOf(r).ok && trustOf(r).kind !== "error").length;
  const isBatch      = results.length > 1;
  const maxWidth     = phase === "done" && isBatch ? 600 : 500;

  return (
    // "safe center" keeps short content centred but stops centring once the
    // content is taller than the viewport — plain `center` pushes the top out
    // of reach, and `overflow: hidden` made it unscrollable, so a failed file
    // at the bottom of a long batch could be clipped away entirely.
    <div style={{ minHeight: "100vh", background: T.bgGradient, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "safe center", padding: "2rem", position: "relative", overflowX: "hidden", overflowY: "auto" }}>
      <Wave />
      <div style={{ marginBottom: "2.5rem", textAlign: "center", animation: "fadeIn 0.3s ease-out", position: "relative" }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: "1.5rem", fontWeight: 700, color: T.text, letterSpacing: "-0.02em", marginBottom: "0.25rem" }}>O'Neill</div>
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: "0.75rem", fontWeight: 500, color: T.textDim, letterSpacing: "0.12em", textTransform: "uppercase" }}>{t.title}</div>
        {/* Language toggle */}
        <button type="button" onClick={toggleLang} style={{
          position: "absolute", right: -60, top: "50%", transform: "translateY(-50%)",
          background: T.panelDeep, border: `1px solid ${T.line}`, borderRadius: 8,
          padding: "0.25rem 0.55rem", cursor: "pointer", fontFamily: "Inter, sans-serif",
          fontSize: "0.72rem", fontWeight: 700, color: T.textMute, letterSpacing: "0.05em",
          transition: "all 0.15s",
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.color = T.brand; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = T.line;  e.currentTarget.style.color = T.textMute; }}
          title={lang === "NL" ? "Switch to English" : "Naar Nederlands"}
        >
          {lang === "NL" ? "EN" : "NL"}
        </button>
      </div>

      <div
        style={{
          background: T.panel, border: `1px solid ${dragging ? T.brand : T.line}`, borderRadius: 20,
          padding: "2.5rem", width: "100%", maxWidth,
          position: "relative", zIndex: 1, transition: "all 0.25s",
          animation: "fadeIn 0.3s ease-out 0.1s both",
          boxShadow: dragging ? `0 0 0 3px ${T.brandSoft}` : "none",
        }}
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
      >
        {notice && (
          <div role="status" style={{
            background: "#1a1200", border: "1px solid #b86e00", borderRadius: 10,
            padding: "0.55rem 0.9rem", marginBottom: "1rem",
            display: "flex", alignItems: "center", gap: "0.5rem",
            fontSize: "0.76rem", color: "#f59e0b",
          }}>
            <AlertTriangle size={14} color="#f59e0b" style={{ flexShrink: 0 }} />
            <span>{notice}</span>
          </div>
        )}
        {phase === "idle"       && <UploadZone dragging={dragging} onPickFile={() => inputRef.current?.click()} history={history} onClearHistory={clearHistory} t={t} />}
        {phase === "processing" && <ProcessingState progress={progress} t={t} />}
        {phase === "done" && !isBatch && (
          <SingleDoneState result={results[0]} onReset={reset} t={t}
            onRedownload={() => downloadSingle(results[0])}
            onForceDownload={() => downloadForce(results[0])} />
        )}
        {phase === "done" && isBatch && (
          <BatchDoneState results={results} successCount={successCount} t={t}
            errorCount={errorCount} partialCount={partialCount}
            onDownloadZip={downloadZip} onDownloadSingle={downloadSingle}
            onForceDownload={downloadForce} onReset={reset} />
        )}
      </div>

      <input ref={inputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={onFileChange} />
      <p style={{ marginTop: "1.5rem", fontSize: "0.7rem", color: T.textGhost, fontFamily: "JetBrains Mono, monospace", zIndex: 1 }}>
        {t.footer}
      </p>
      <style>{`
        @keyframes spin      { to { transform: rotate(360deg); } }
        @keyframes fadeIn    { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
        @keyframes wavePulse { 0%,100%{transform:scaleY(0.2);opacity:0.3} 50%{transform:scaleY(1);opacity:1} }
        .preview-table     { width:100%; border-collapse:collapse; font-size:0.72rem; }
        .preview-table th  { text-align:left; padding:0.3rem 0.5rem; color:${T.textDim}; font-weight:600; border-bottom:1px solid ${T.line}; white-space:nowrap; }
        .preview-table td  { padding:0.28rem 0.5rem; color:${T.text}; border-bottom:1px solid ${T.panelDeep}; }
        .preview-table tr:last-child td { border-bottom:none; }
        .preview-table .num { text-align:right; font-family:'JetBrains Mono',monospace; }
      `}</style>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

// ── One place decides whether an export can be trusted ──────────────────────
// Six surfaces used to re-derive this independently — the badge, the batch row,
// the ZIP suffix, the history writer, the download buttons and the warnings —
// each looking at a different mix of isPartial / checked / qty / uncertainCount.
// They disagreed: the same file could be amber in the badge, green in the
// history and unlabelled in the ZIP. Everything now routes through here.
const TRUST_ORDER = ["error", "partial", "unchecked", "drift", "noweight", "uncertain", "gaps", "nodata"];

function trustOf(r) {
  if (!r)                     return { ok: false, kind: "error" };
  if (r.error)                return { ok: false, kind: "error" };
  if (r.isPartial)            return { ok: false, kind: "partial" };
  if (r.checked === false)    return { ok: false, kind: "unchecked" };
  if (r.driftCount > 0)       return { ok: false, kind: "drift" };
  if (r.noWeightCount > 0)    return { ok: false, kind: "noweight" };
  if (r.uncertainCount > 0)   return { ok: false, kind: "uncertain" };
  if (r.unparsedCount > 0)    return { ok: false, kind: "gaps" };
  // No quantity means the validation headers never arrived; the conversion
  // cannot be vouched for even though the response was a 200.
  if (!r.qty)                 return { ok: false, kind: "nodata" };
  return { ok: true, kind: "ok" };
}

// Filename an export must carry so its status survives leaving the browser.
// Applied on EVERY download route, not just the ZIP — the auto-download after
// a mismatch used to land in the downloads folder under a clean name before
// the warning had even rendered.
function exportNameFor(r, t) {
  const { ok, kind } = trustOf(r);
  if (ok || kind === "error") return r.xlsxName;
  const suffix = t.trustSuffix[kind];
  if (!suffix) return r.xlsxName;
  return r.xlsxName.replace(/\.xlsx$/i, "") + ` ${suffix}.xlsx`;
}

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ── sub-components ────────────────────────────────────────────────────────────

function timeAgo(ts, t) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60)    return t.justNow;
  if (diff < 3600)  return t.minAgo(Math.floor(diff / 60));
  if (diff < 86400) return t.hourAgo(Math.floor(diff / 3600));
  const d = Math.floor(diff / 86400);
  return d === 1 ? t.yesterday : t.daysAgo(d);
}

function UploadZone({ dragging, onPickFile, history, onClearHistory, t }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div onClick={onPickFile} style={{ cursor: "pointer" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 16,
          background: dragging ? T.brandSoft : T.panelDeep,
          border: `1px solid ${dragging ? T.brand : T.lineHi}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 1.5rem", transition: "all 0.2s",
        }}>
          <Upload size={28} color={dragging ? T.brand : T.textMute} />
        </div>
        <p style={{ fontFamily: "Inter, sans-serif", fontSize: "1rem", fontWeight: 600, color: T.text, marginBottom: "0.5rem" }}>
          {dragging ? t.dragHere : t.uploadTitle}
        </p>
        <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.75rem", lineHeight: 1.5 }}>
          {t.uploadSub}
        </p>
        <button type="button" style={{
          background: T.brand, color: "#071520", border: "none", borderRadius: 10,
          padding: "0.625rem 1.5rem", fontFamily: "Inter, sans-serif",
          fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", transition: "opacity 0.15s",
        }}
          onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
          onMouseLeave={e => e.currentTarget.style.opacity = "1"}
        >
          {t.chooseFile}
        </button>
        <p style={{ marginTop: "1.5rem", fontSize: "0.72rem", color: T.textGhost, lineHeight: 1.6 }}>
          {t.uploadHint}<br />{t.uploadHint2}
        </p>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: "1.75rem", textAlign: "left" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.7rem", color: T.textDim, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" }}>
              <Clock size={12} /> {t.recentTitle}
            </span>
            <button type="button" onClick={(e) => { e.stopPropagation(); onClearHistory(); }} style={{
              background: "transparent", border: "none", cursor: "pointer", padding: "0.15rem 0.3rem",
              display: "flex", alignItems: "center", gap: "0.25rem",
              fontSize: "0.68rem", color: T.textGhost, borderRadius: 4,
            }}
              onMouseEnter={e => e.currentTarget.style.color = T.bad}
              onMouseLeave={e => e.currentTarget.style.color = T.textGhost}
            >
              <Trash2 size={11} /> {t.clearHistory}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            {history.map((h, i) => (
              <div key={i} style={{
                background: T.panelDeep, borderRadius: 8, padding: "0.45rem 0.75rem",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                border: `1px solid ${T.line}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                  <CheckCircle2 size={12} color={T.good} style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: "0.75rem", color: T.text, fontFamily: "JetBrains Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {h.name}
                  </span>
                </div>
                <div style={{ display: "flex", gap: "0.75rem", flexShrink: 0, marginLeft: "0.75rem" }}>
                  <span style={{ fontSize: "0.7rem", color: T.good }}>{h.qty} {t.rows}</span>
                  <span style={{ fontSize: "0.7rem", color: T.textDim, fontFamily: "JetBrains Mono, monospace" }}>CHF {fmtCHF(h.total)}</span>
                  <span style={{ fontSize: "0.68rem", color: T.textGhost }}>{timeAgo(h.ts, t)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WaveLoader() {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 5, height: 48, marginBottom: "1.5rem" }}>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} style={{
          width: 6, height: 36, borderRadius: 3,
          background: T.brand,
          animation: "wavePulse 1.1s ease-in-out infinite",
          animationDelay: `${i * 0.14}s`,
          transformOrigin: "bottom center",
        }} />
      ))}
    </div>
  );
}

function ProcessingState({ progress, t }) {
  const pct = progress.total > 1 ? Math.round((progress.i - 1) / progress.total * 100) : 0;
  return (
    <div style={{ textAlign: "center", padding: "1rem 0" }}>
      <WaveLoader />
      {progress.total > 1 && (
        <>
          <p style={{ fontSize: "0.75rem", color: T.textDim, marginBottom: "0.5rem" }}>{t.processingOf(progress.i, progress.total)}</p>
          <div style={{ background: T.panelDeep, borderRadius: 99, height: 4, marginBottom: "1rem", overflow: "hidden" }}>
            <div style={{ background: T.brand, height: "100%", width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
        </>
      )}
      <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>{t.processing}</p>
      <p style={{ fontSize: "0.8rem", color: T.textDim, fontFamily: "JetBrains Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 340, margin: "0 auto" }}>
        {progress.name}
      </p>
    </div>
  );
}

function PreviewTable({ rows, totalItems, t }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ marginTop: "1.25rem", borderRadius: 10, overflow: "hidden", border: `1px solid ${T.line}` }}>
      <div style={{ padding: "0.4rem 0.75rem", background: T.panelDeep, borderBottom: `1px solid ${T.line}`, fontSize: "0.7rem", color: T.textDim, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {t.previewTitle(rows.length)}
      </div>
      <div style={{ overflowX: "auto", background: T.panel }}>
        <table className="preview-table">
          <thead>
            <tr>
              <th>{t.colNr}</th><th>{t.colItem}</th><th>{t.colColour}</th>
              <th className="num">{t.colQty}</th><th className="num">{t.colPrice}</th><th className="num">{t.colTotal}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "JetBrains Mono, monospace", color: T.textMute }}>{r.n}</td>
                <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.i}</td>
                <td style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: T.textMute }}>{r.c}</td>
                <td className="num">{r.q}</td>
                <td className="num">{fmtCHF(r.p)}</td>
                <td className="num">{fmtCHF(r.t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalItems > rows.length && (
        <div style={{ padding: "0.35rem 0.75rem", background: T.panelDeep, borderTop: `1px solid ${T.line}`, fontSize: "0.7rem", color: T.textGhost }}>
          {t.previewMore(totalItems - rows.length)}
        </div>
      )}
    </div>
  );
}

function ValidationBadge({ qty, total, checked, qtyChecked, totalChecked, t }) {
  if (!qty) return null;
  // `checked` is now true only when BOTH axes ran. When exactly one ran, say
  // which — "passed" would claim a guarantee that covers only half the risk.
  const isChecked = checked !== false;
  const partial   = !isChecked && (qtyChecked || totalChecked);
  const label     = isChecked ? t.validOk
                  : partial   ? (qtyChecked ? t.validQtyOnly : t.validTotalOnly)
                  : t.validUnchecked;
  const accent    = isChecked ? T.good     : "#f59e0b";
  const bg        = isChecked ? T.goodSoft : "#1a1200";
  return (
    <div style={{
      background: bg, border: `1px solid ${accent}`, borderRadius: 10,
      padding: "0.5rem 1rem", marginBottom: "0.75rem",
      display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
      flexWrap: "wrap",
    }}>
      {isChecked ? <CheckCircle2 size={16} color={accent} /> : <AlertTriangle size={16} color={accent} />}
      <span style={{ fontSize: "0.82rem", color: T.text, fontWeight: 600 }}>
        {t.validRows(qty, fmtCHF(total))}
      </span>
      <span style={{ fontSize: "0.72rem", color: accent }}>{label}</span>
    </div>
  );
}

function humanReason(raw, t) {
  if (!raw) return "";
  // "N CHF values after tariff" → readable
  const chfM = /^(\d+) (?:CHF|EUR|GBP|currency) values? after tariff$/.exec(raw);
  if (chfM) return `incomplete price data (${chfM[1]} value${chfM[1] === "1" ? "" : "s"} found, need 3)`;
  return t.missedReasons[raw] || t.missedReasonDefault(raw);
}

function PartialWarning({ result, onForceDownload, t }) {
  const [showDetails, setShowDetails] = React.useState(false);

  // unparsedItemNos: item numbers visible in PDF but missing from output (no reason known)
  const unparsed = (result.unparsedItemNos || []).map(r => typeof r === "string" ? r : r.itemNo);
  // missedRows: blocks that were found but failed to parse (with reason).
  // "???" means the line was found but its item number could not be read at all —
  // the worst case, and previously the only one filtered out of this list.
  const missed   = result.missedRows || [];
  const named    = missed.filter(r => r.itemNo !== "???");
  const unnamed  = missed.filter(r => r.itemNo === "???");

  // Items to show in the simple label line: prefer unparsed (more accurate), fall back to missed
  const namedList = unparsed.length > 0 ? unparsed : named.map(r => r.itemNo);

  // Detailed rows to show when expanded: every missed row that carries a reason
  const detailRows = missed.filter(r => r.reason);

  return (
    <div style={{
      background: "#1a1200", border: `1px solid #b86e00`, borderRadius: 10,
      padding: "0.85rem 1rem", marginBottom: "1rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
        <AlertTriangle size={16} color="#f59e0b" />
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#f59e0b" }}>{t.mismatchTitle}</span>
      </div>
      <p style={{ fontSize: "0.78rem", color: T.textDim, lineHeight: 1.5 }}>
        {t.mismatchFound} <strong style={{ color: T.text }}>{result.qty} {t.rows} · {fmtCHF(result.total)}</strong><br />
        {t.mismatchExp} <strong style={{ color: T.text }}>{result.expectedQty} {t.rows} · {fmtCHF(result.expectedTotal)}</strong>
        {/* Name the actual discrepancy — the amount can be off while the piece
            count matches, and subtracting two small numbers is the reader's job otherwise. */}
        {(result.expectedQty != null || result.expectedTotal != null) && (
          <><br />
            <span style={{ color: "#f59e0b" }}>
              {result.expectedQty != null && t.shortBy(result.expectedQty - result.qty)}
              {result.expectedTotal != null && Math.abs(result.expectedTotal - result.total) >= 0.01 &&
                `${result.expectedQty != null ? " · " : ""}${t.amountOff(result.expectedTotal - result.total)}`}
            </span>
          </>
        )}
      </p>
      {result.forcedAt && (
        <p style={{ fontSize: "0.7rem", color: T.textMute, marginTop: "0.35rem" }}>{t.forcedNote}</p>
      )}
      {result.forceError && (
        <p style={{ fontSize: "0.7rem", color: T.bad, marginTop: "0.35rem" }}>{t.forceFailed(result.forceError)}</p>
      )}

      {namedList.length > 0 && (
        <p style={{ fontSize: "0.72rem", color: T.textDim, marginTop: "0.35rem", fontFamily: "JetBrains Mono, monospace" }}>
          {t.missedItemsLabel}: {namedList.join(", ")}
        </p>
      )}

      {unnamed.length > 0 && (
        <p style={{ fontSize: "0.72rem", color: "#f59e0b", marginTop: "0.35rem" }}>
          {t.unreadableRows(unnamed.length)}
        </p>
      )}

      {detailRows.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={() => setShowDetails(v => !v)}
            style={{
              background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: "0.72rem", color: "#f59e0b", fontFamily: "Inter, sans-serif",
              display: "flex", alignItems: "center", gap: "0.3rem",
            }}
          >
            <span style={{ fontSize: "0.65rem" }}>{showDetails ? "▾" : "▸"}</span>
            {t.missedDetailsLabel} ({detailRows.length})
          </button>
          {showDetails && (
            <table style={{ marginTop: "0.4rem", borderCollapse: "collapse", width: "100%", fontSize: "0.7rem" }}>
              <tbody>
                {detailRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: i > 0 ? "1px solid #2a1800" : "none" }}>
                    <td style={{ padding: "0.2rem 0.5rem 0.2rem 0", color: "#f59e0b", fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap" }}>
                      {r.itemNo}
                    </td>
                    <td style={{ padding: "0.2rem 0", color: T.textDim }}>
                      {humanReason(r.reason, t)}
                      {/* For an unreadable line the item number tells the user nothing,
                          so show the raw text instead — that is what they search the PDF for. */}
                      {r.itemNo === "???" && r.context && (
                        <div style={{
                          marginTop: "0.15rem", fontFamily: "JetBrains Mono, monospace",
                          fontSize: "0.66rem", color: T.textMute,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {r.context.slice(0, 90)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <button type="button" onClick={onForceDownload} disabled={result.forceLoading} style={{
        background: "#f59e0b", color: "#1a0e00", border: "none", borderRadius: 8,
        padding: "0.4rem 0.9rem", fontFamily: "Inter, sans-serif",
        fontWeight: 600, fontSize: "0.8rem", cursor: result.forceLoading ? "wait" : "pointer",
        opacity: result.forceLoading ? 0.6 : 1,
        display: "inline-flex", alignItems: "center", gap: "0.4rem",
        marginTop: "0.75rem",
      }}>
        {result.forceLoading ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <FileDown size={13} />}
        {result.blob ? t.redownload : t.downloadAnyway}
      </button>
    </div>
  );
}

// Lines whose quantity/price split could not be reconciled with the line total.
// The invoice total still adds up, so validation passes and nothing else in the
// UI would ever mention it — but the quantity is what gets declared to customs.
function UncertainQtyWarning({ items, count, t }) {
  if (!count) return null;
  const list = items || [];
  return (
    <div style={{
      background: T.panelDeep, border: `1px solid #5a4400`, borderRadius: 8,
      padding: "0.6rem 0.85rem", marginBottom: "0.75rem",
      display: "flex", alignItems: "flex-start", gap: "0.5rem",
    }}>
      <AlertTriangle size={13} color="#c78c00" style={{ marginTop: 2, flexShrink: 0 }} />
      <p style={{ fontSize: "0.72rem", color: T.textDim, lineHeight: 1.5, margin: 0 }}>
        {t.uncertainQtyNote(count)}{" "}
        {list.length > 0 && (
          <span style={{ fontFamily: "JetBrains Mono, monospace", color: T.textMute }}>
            {list.slice(0, 12).join(", ")}{list.length > 12 ? ` +${list.length - 12}` : ""}
          </span>
        )}
      </p>
    </div>
  );
}

// The workbook recomputes each line as qty × price − discount, which can differ
// from the total the invoice states for that line. Without this the delivered
// file could disagree with the invoice and nothing would say so.
function ExcelDriftWarning({ result, t }) {
  if (!result.driftCount) return null;
  const items = result.driftItems || [];
  return (
    <div style={{
      background: T.panelDeep, border: `1px solid #5a4400`, borderRadius: 8,
      padding: "0.6rem 0.85rem", marginBottom: "0.75rem",
      display: "flex", alignItems: "flex-start", gap: "0.5rem",
    }}>
      <AlertTriangle size={13} color="#c78c00" style={{ marginTop: 2, flexShrink: 0 }} />
      <p style={{ fontSize: "0.72rem", color: T.textDim, lineHeight: 1.5, margin: 0 }}>
        {t.driftNote(result.driftCount, fmtCHF(result.excelTotal), fmtCHF(result.total))}{" "}
        {items.length > 0 && (
          <span style={{ fontFamily: "JetBrains Mono, monospace", color: T.textMute }}>
            {items.slice(0, 12).join(", ")}{items.length > 12 ? ` +${items.length - 12}` : ""}
          </span>
        )}
      </p>
    </div>
  );
}

function SilentGapWarning({ unparsedItemNos, t }) {
  if (!unparsedItemNos || unparsedItemNos.length === 0) return null;
  return (
    <div style={{
      background: T.panelDeep, border: `1px solid #5a4400`, borderRadius: 8,
      padding: "0.6rem 0.85rem", marginBottom: "0.75rem",
      display: "flex", alignItems: "flex-start", gap: "0.5rem",
    }}>
      <AlertTriangle size={13} color="#c78c00" style={{ marginTop: 2, flexShrink: 0 }} />
      <p style={{ fontSize: "0.72rem", color: T.textDim, lineHeight: 1.5, margin: 0 }}>
        {t.silentGapNote(unparsedItemNos.length)}{" "}
        <span style={{ fontFamily: "JetBrains Mono, monospace", color: T.textMute }}>{unparsedItemNos.join(", ")}</span>
      </p>
    </div>
  );
}

function SingleDoneState({ result, onReset, onRedownload, onForceDownload, t }) {
  const isError   = !!result.error;
  const isPartial = result.isPartial;
  // `isOk` used to mean "did not throw", which drew the green tick over results
  // with a guessed quantity, a drifting total or missing lines. It now means
  // "can be vouched for", from the same predicate the filename and ZIP use.
  const trust     = trustOf(result);
  const isOk      = !isError && !isPartial;
  const isVouched = trust.ok;

  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: isError ? T.badSoft : isVouched ? T.goodSoft : "#1a1200",
          border: `1px solid ${isError ? T.bad : isVouched ? T.good : "#b86e00"}`,
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem",
        }}>
          {isError    && <AlertCircle   size={26} color={T.bad} />}
          {!isError && !isVouched && <AlertTriangle size={26} color="#f59e0b" />}
          {isVouched  && <CheckCircle2  size={26} color={T.good} />}
        </div>

        {isError && (
          <>
            <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>{t.failTitle}</p>
            <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.5rem", lineHeight: 1.5 }}>{result.error}</p>
          </>
        )}

        {isOk && (
          <>
            <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.75rem" }}>{t.downloadStart}</p>
            <ValidationBadge qty={result.qty} total={result.total} checked={result.checked}
              qtyChecked={result.qtyChecked} totalChecked={result.totalChecked} t={t} />
            <p style={{ fontSize: "0.73rem", color: T.textMute, fontFamily: "JetBrains Mono, monospace", marginBottom: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {exportNameFor(result, t)}
            </p>
            <button type="button" onClick={onRedownload} style={{
              background: "transparent", color: T.textMute, border: `1px solid ${T.line}`,
              borderRadius: 8, padding: "0.3rem 0.75rem", fontFamily: "Inter, sans-serif",
              fontWeight: 500, fontSize: "0.78rem", cursor: "pointer", marginBottom: "1rem",
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
            }}>
              <FileDown size={13} /> {t.redownload}
            </button>
            <SilentGapWarning unparsedItemNos={result.unparsedItemNos} t={t} />
            <UncertainQtyWarning items={result.uncertainItems} count={result.uncertainCount} t={t} />
            <ExcelDriftWarning result={result} t={t} />
          </>
        )}

        {isPartial && (
          <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.75rem" }}>{t.checkResults}</p>
        )}
      </div>

      {isPartial && <PartialWarning result={result} onForceDownload={onForceDownload} t={t} />}

      {/* totalItems is a line count, not a piece count — passing qty here
          produced "+213 more rows" on a forty-line invoice. */}
      {isOk && result.preview?.length > 0 && (
        <PreviewTable rows={result.preview} totalItems={result.lineCount || result.preview.length} t={t} />
      )}

      <div style={{ marginTop: "1.25rem", textAlign: "center" }}>
        <button type="button" onClick={onReset} style={{
          background: T.lineHi, color: T.text, border: `1px solid ${T.line}`,
          borderRadius: 10, padding: "0.5rem 1.25rem",
          fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: "0.85rem", cursor: "pointer",
        }}>
          {t.newInvoice}
        </button>
      </div>
    </div>
  );
}

// Compact version of PartialWarning's item list, for a batch row.
function BatchMissingItems({ result, t }) {
  const unparsed = (result.unparsedItemNos || []).map(r => typeof r === "string" ? r : r.itemNo);
  const missed   = result.missedRows || [];
  const named    = unparsed.length > 0 ? unparsed : missed.filter(r => r.itemNo !== "???").map(r => r.itemNo);
  const unnamed  = missed.filter(r => r.itemNo === "???").length;
  if (!named.length && !unnamed) return null;

  const shown = named.slice(0, 8);
  const rest  = named.length - shown.length;
  return (
    <div style={{ fontSize: "0.66rem", color: T.textDim, marginTop: "0.15rem", marginLeft: 17, lineHeight: 1.5 }}>
      {shown.length > 0 && (
        <div style={{ fontFamily: "JetBrains Mono, monospace", wordBreak: "break-word" }}>
          {t.missedItemsLabel}: {shown.join(", ")}{rest > 0 ? ` +${rest}` : ""}
        </div>
      )}
      {unnamed > 0 && <div style={{ color: "#f59e0b" }}>{t.unreadableRows(unnamed)}</div>}
    </div>
  );
}

function BatchDoneState({ results, successCount, errorCount, partialCount, onDownloadZip, onDownloadSingle, onForceDownload, onReset, t }) {
  const allOk = errorCount === 0 && partialCount === 0;
  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          background: allOk ? T.goodSoft : errorCount > 0 ? T.badSoft : "#1a1200",
          border: `1px solid ${allOk ? T.good : errorCount > 0 ? T.bad : "#b86e00"}`,
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem",
        }}>
          {allOk        && <CheckCircle2  size={24} color={T.good} />}
          {errorCount>0 && <AlertCircle   size={24} color={T.bad} />}
          {!allOk && errorCount===0 && <AlertTriangle size={24} color="#f59e0b" />}
        </div>
        <p style={{ fontWeight: 600, color: T.text }}>
          {t.filesOf(successCount, results.length)}
        </p>
        {(errorCount > 0 || partialCount > 0) && (
          <p style={{ fontSize: "0.8rem", color: T.textDim, marginTop: "0.25rem" }}>
            {errorCount > 0   && t.failedCount(errorCount)}
            {errorCount > 0 && partialCount > 0 && " · "}
            {partialCount > 0 && t.warnCount(partialCount)}
          </p>
        )}
      </div>

      <div style={{
        display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem",
        // Long batches get their own scroll area so the summary and the reset
        // button below stay reachable no matter how many files were dropped.
        maxHeight: "min(55vh, 560px)", overflowY: "auto", overflowX: "hidden",
      }}>
        {results.map((r, i) => {
          // Row chrome comes from the same predicate as the filename and the
          // history, so a row can no longer read green while its file is flagged.
          const { ok, kind } = trustOf(r);
          return (
          <div key={i}>
            <div style={{
              background: T.panelDeep,
              border: `1px solid ${kind === "error" ? T.bad : ok ? T.line : "#b86e00"}`,
              borderRadius: 10, padding: "0.6rem 0.9rem",
              display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem",
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  {kind === "error" && <AlertCircle   size={13} color={T.bad} />}
                  {!ok && kind !== "error" && <AlertTriangle size={13} color="#f59e0b" />}
                  {ok && <CheckCircle2 size={13} color={T.good} />}
                  <span style={{ fontSize: "0.78rem", color: T.text, fontFamily: "JetBrains Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.xlsxName || r.name}
                  </span>
                </div>
                {r.error && <p style={{ fontSize: "0.7rem", color: T.bad,   marginTop: "0.2rem", marginLeft: 17 }}>{r.error}</p>}
                {r.isPartial && (
                  <>
                    <p style={{ fontSize: "0.7rem", color: "#f59e0b", marginTop: "0.2rem", marginLeft: 17 }}>
                      {t.mismatchFound} {r.qty} / {r.expectedQty} {t.rows}
                      {r.expectedQty != null && ` (${t.shortBy(r.expectedQty - r.qty)})`}
                      {/* The amount can be the real discrepancy while the piece
                          count matches; batch mode used to show only the count. */}
                      {r.expectedTotal != null && Math.abs(r.expectedTotal - r.total) >= 0.01 &&
                        ` · ${t.amountOff(r.expectedTotal - r.total)}`}
                    </p>
                    {r.forcedAt && (
                      <p style={{ fontSize: "0.66rem", color: T.textMute, marginTop: "0.1rem", marginLeft: 17 }}>
                        {t.forcedNote}
                      </p>
                    )}
                    {r.forceError && (
                      <p style={{ fontSize: "0.66rem", color: T.bad, marginTop: "0.1rem", marginLeft: 17 }}>
                        {t.forceFailed(r.forceError)}
                      </p>
                    )}
                    {/* The missing item numbers were held in state but never rendered
                        in batch mode, forcing staff to re-upload the file alone. */}
                    <BatchMissingItems result={r} t={t} />
                  </>
                )}
                {!r.error && !r.isPartial && (
                  <p style={{
                    fontSize: "0.7rem", marginTop: "0.2rem", marginLeft: 17,
                    color: ok ? T.good : "#f59e0b",
                  }}>
                    {ok ? "✓" : "⚠"} {r.qty || 0} {t.rows} · CHF {fmtCHF(r.total)}
                    {!ok && ` · ${t.trustReason[kind]}`}
                  </p>
                )}
                {!r.error && !r.isPartial && !ok && <BatchMissingItems result={r} t={t} />}
              </div>
              <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                {r.isPartial && (
                  <button type="button" onClick={() => onForceDownload(r)} disabled={r.forceLoading} style={{
                    background: "#f59e0b", color: "#1a0e00", border: "none",
                    borderRadius: 7, padding: "0.3rem 0.6rem", cursor: r.forceLoading ? "wait" : "pointer",
                    fontFamily: "Inter, sans-serif", fontWeight: 600, fontSize: "0.72rem",
                    display: "flex", alignItems: "center", gap: "0.3rem", opacity: r.forceLoading ? 0.6 : 1,
                  }}>
                    {r.forceLoading ? <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} /> : <FileDown size={11} />}
                    {t.anyway}
                  </button>
                )}
                {!r.error && !r.isPartial && (
                  <button type="button" onClick={() => onDownloadSingle(r)} style={{
                    background: "transparent", color: T.textMute, border: `1px solid ${T.line}`,
                    borderRadius: 7, padding: "0.3rem 0.6rem", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.72rem",
                  }}>
                    <FileDown size={11} /> {t.download}
                  </button>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        {results.filter(r => r.blob).length > 1 && (
          <button type="button" onClick={onDownloadZip} style={{
            background: T.brand, color: "#071520", border: "none", borderRadius: 10,
            padding: "0.6rem 1.25rem", fontFamily: "Inter, sans-serif",
            fontWeight: 600, fontSize: "0.875rem", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "0.5rem", transition: "opacity 0.15s",
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
            onMouseLeave={e => e.currentTarget.style.opacity = "1"}
          >
            <Archive size={16} /> {t.downloadZip}
          </button>
        )}
        <button type="button" onClick={onReset} style={{
          background: T.lineHi, color: T.text, border: `1px solid ${T.line}`,
          borderRadius: 10, padding: "0.6rem 1.25rem",
          fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer",
        }}>
          {t.newInvoices}
        </button>
      </div>
    </div>
  );
}
