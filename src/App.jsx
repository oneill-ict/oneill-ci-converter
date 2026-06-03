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
    validRows:     (q, t) => `${q} regels · CHF ${t}`,
    redownload:    "Opnieuw downloaden",
    newInvoice:    "Nieuwe factuur converteren",
    newInvoices:   "Nieuwe facturen",
    checkResults:  "Controleer de resultaten",
    mismatchTitle: "Aantal regels komt niet overeen",
    mismatchFound: "Gevonden:",
    mismatchExp:   "Verwacht:",
    missedItemsLabel: "Ontbrekend in export",
    downloadAnyway:"Download toch",
    failTitle:     "Verwerking mislukt",
    filesOf:       (s, n) => `${s} van ${n} bestanden verwerkt`,
    failedCount:   (n) => `${n} mislukt`,
    warnCount:     (n) => `${n} met waarschuwing`,
    downloadZip:   "Download alle als ZIP",
    recentTitle:   "Recent",
    clearHistory:  "Wissen",
    rows:          "regels",
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
    validRows:     (q, t) => `${q} lines · CHF ${t}`,
    redownload:    "Download again",
    newInvoice:    "Convert new invoice",
    newInvoices:   "New invoices",
    checkResults:  "Check the results",
    mismatchTitle: "Line count mismatch",
    mismatchFound: "Found:",
    mismatchExp:   "Expected:",
    missedItemsLabel: "Missing from export",
    downloadAnyway:"Download anyway",
    failTitle:     "Processing failed",
    filesOf:       (s, n) => `${s} of ${n} files processed`,
    failedCount:   (n) => `${n} failed`,
    warnCount:     (n) => `${n} with warning`,
    downloadZip:   "Download all as ZIP",
    recentTitle:   "Recent",
    clearHistory:  "Clear",
    rows:          "lines",
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
      e.isPartial    = true;
      e.parsedQty    = err.parsedQty;
      e.expectedQty  = err.expectedQty;
      e.parsedTotal  = err.parsedTotal;
      e.expectedTotal = err.expectedTotal;
      e.missedRows   = err.missedRows || [];
      throw e;
    }
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const qty        = parseInt(res.headers.get("X-Validation-Qty")   || "0", 10);
  const total      = parseFloat(res.headers.get("X-Validation-Total") || "0");
  const previewRaw = res.headers.get("X-Preview");
  const preview    = previewRaw ? JSON.parse(previewRaw) : [];
  const blob       = await res.blob();
  return { blob, qty, total, preview };
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
    const pdfs = [...files].filter(f => f.type === "application/pdf");
    if (!pdfs.length) return;

    setPhase("processing");
    setResults([]);

    const batch = [];
    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      setProgress({ i: i + 1, total: pdfs.length, name: file.name });
      const xlsxName = file.name.replace(/\.[^.]+$/, "") + ".xlsx";

      try {
        const { blob, qty, total, preview } = await convertFile(file);
        // Single file: trigger immediate download
        if (pdfs.length === 1) triggerDownload(blob, xlsxName);
        batch.push({ name: file.name, xlsxName, blob, qty, total, preview, error: null, isPartial: false, file });
      } catch (e) {
        if (e.isPartial) {
          // Validation mismatch — auto-download the export anyway so the team can continue,
          // then show the warning with details about what was missed.
          let autoBlob = null, autoPreview = [];
          try {
            const forced = await convertFile(file, true);
            autoBlob    = forced.blob;
            autoPreview = forced.preview;
            if (pdfs.length === 1) triggerDownload(autoBlob, xlsxName);
          } catch {}
          batch.push({
            name: file.name, xlsxName, blob: autoBlob,
            qty: e.parsedQty, total: e.parsedTotal,
            expectedQty: e.expectedQty, expectedTotal: e.expectedTotal,
            missedRows: e.missedRows || [],
            preview: autoPreview, error: null, isPartial: true, file,
          });
        } else {
          batch.push({ name: file.name, xlsxName, blob: null, qty: null, total: null, preview: [], error: e.message, isPartial: false, file });
        }
      }
    }

    setResults(batch);
    setPhase("done");

    // Persist successful conversions to history
    const newEntries = batch
      .filter(r => !r.error && !r.isPartial)
      .map(r => ({ name: r.xlsxName, qty: r.qty, total: r.total, ts: Date.now() }));
    if (newEntries.length) {
      setHistory(prev => {
        const updated = [...newEntries, ...prev].slice(0, MAX_HISTORY);
        saveHistory(updated);
        return updated;
      });
    }
  }, []);

  // Force-download a partial result. If blob is already stored (auto-downloaded), just re-trigger.
  const downloadForce = useCallback(async (r) => {
    if (r.blob) { triggerDownload(r.blob, r.xlsxName); return; }
    setResults(prev => prev.map(p => p === r ? { ...p, forceLoading: true } : p));
    try {
      const { blob, qty, total, preview } = await convertFile(r.file, true);
      triggerDownload(blob, r.xlsxName);
      setResults(prev => prev.map(p => p === r
        ? { ...p, blob, qty, total, preview, isPartial: false, forceLoading: false }
        : p));
    } catch (e) {
      setResults(prev => prev.map(p => p === r
        ? { ...p, error: e.message, isPartial: false, forceLoading: false }
        : p));
    }
  }, []);

  const downloadSingle = (r) => triggerDownload(r.blob, r.xlsxName);

  const downloadZip = async () => {
    const zip = new JSZip();
    for (const r of results) if (r.blob) zip.file(r.xlsxName, r.blob);
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    triggerDownload(zipBlob, "commercial-invoices.zip");
  };

  const reset = () => { setPhase("idle"); setResults([]); setProgress({ i: 0, total: 0, name: "" }); };
  const clearHistory = () => { saveHistory([]); setHistory([]); };

  const onFileChange = (e) => { if (e.target.files?.length) runBatch(e.target.files); e.target.value = ""; };
  const onDrop       = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) runBatch(e.dataTransfer.files); };
  const onDragOver   = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave  = () => setDragging(false);

  const successCount = results.filter(r => !r.error && !r.isPartial).length;
  const errorCount   = results.filter(r => r.error).length;
  const partialCount = results.filter(r => r.isPartial).length;
  const isBatch      = results.length > 1;
  const maxWidth     = phase === "done" && isBatch ? 600 : 500;

  return (
    <div style={{ minHeight: "100vh", background: T.bgGradient, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", position: "relative", overflow: "hidden" }}>
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
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeIn  { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }
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

function ProcessingState({ progress, t }) {
  const pct = progress.total > 1 ? Math.round((progress.i - 1) / progress.total * 100) : 0;
  return (
    <div style={{ textAlign: "center", padding: "1rem 0" }}>
      <Loader2 size={40} color={T.brand} style={{ animation: "spin 1s linear infinite", marginBottom: "1.5rem" }} />
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

function ValidationBadge({ qty, total, t }) {
  if (!qty) return null;
  return (
    <div style={{
      background: T.goodSoft, border: `1px solid ${T.good}`, borderRadius: 10,
      padding: "0.5rem 1rem", marginBottom: "0.75rem",
      display: "flex", alignItems: "center", justifyContent: "center", gap: "0.75rem",
    }}>
      <CheckCircle2 size={16} color={T.good} />
      <span style={{ fontSize: "0.82rem", color: T.text, fontWeight: 600 }}>
        {t.validRows(qty, fmtCHF(total))}
      </span>
      <span style={{ fontSize: "0.72rem", color: T.good }}>{t.validOk}</span>
    </div>
  );
}

function PartialWarning({ result, onForceDownload, t }) {
  const named = (result.missedRows || []).filter(r => r.itemNo !== "???");
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
        {t.mismatchFound} <strong style={{ color: T.text }}>{result.qty} {t.rows} · CHF {fmtCHF(result.total)}</strong><br />
        {t.mismatchExp} <strong style={{ color: T.text }}>{result.expectedQty} {t.rows} · CHF {fmtCHF(result.expectedTotal)}</strong>
      </p>
      {named.length > 0 && (
        <p style={{ fontSize: "0.72rem", color: T.textDim, marginTop: "0.35rem", fontFamily: "JetBrains Mono, monospace" }}>
          {t.missedItemsLabel}: {named.map(r => r.itemNo).join(", ")}
        </p>
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

function SingleDoneState({ result, onReset, onRedownload, onForceDownload, t }) {
  const isError   = !!result.error;
  const isPartial = result.isPartial;
  const isOk      = !isError && !isPartial;

  return (
    <div style={{ padding: "0.5rem 0" }}>
      <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: isError ? T.badSoft : isPartial ? "#1a1200" : T.goodSoft,
          border: `1px solid ${isError ? T.bad : isPartial ? "#b86e00" : T.good}`,
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem",
        }}>
          {isError   && <AlertCircle   size={26} color={T.bad} />}
          {isPartial && <AlertTriangle size={26} color="#f59e0b" />}
          {isOk      && <CheckCircle2  size={26} color={T.good} />}
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
            <ValidationBadge qty={result.qty} total={result.total} t={t} />
            <p style={{ fontSize: "0.73rem", color: T.textMute, fontFamily: "JetBrains Mono, monospace", marginBottom: "0.75rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {result.xlsxName}
            </p>
            <button type="button" onClick={onRedownload} style={{
              background: "transparent", color: T.textMute, border: `1px solid ${T.line}`,
              borderRadius: 8, padding: "0.3rem 0.75rem", fontFamily: "Inter, sans-serif",
              fontWeight: 500, fontSize: "0.78rem", cursor: "pointer", marginBottom: "1rem",
              display: "inline-flex", alignItems: "center", gap: "0.4rem",
            }}>
              <FileDown size={13} /> {t.redownload}
            </button>
          </>
        )}

        {isPartial && (
          <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.75rem" }}>{t.checkResults}</p>
        )}
      </div>

      {isPartial && <PartialWarning result={result} onForceDownload={onForceDownload} t={t} />}

      {isOk && result.preview?.length > 0 && (
        <PreviewTable rows={result.preview} totalItems={result.qty} t={t} />
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

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {results.map((r, i) => (
          <div key={i}>
            <div style={{
              background: T.panelDeep,
              border: `1px solid ${r.error ? T.bad : r.isPartial ? "#b86e00" : T.line}`,
              borderRadius: 10, padding: "0.6rem 0.9rem",
              display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem",
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  {r.error    && <AlertCircle   size={13} color={T.bad} />}
                  {r.isPartial && <AlertTriangle size={13} color="#f59e0b" />}
                  {!r.error && !r.isPartial && <CheckCircle2 size={13} color={T.good} />}
                  <span style={{ fontSize: "0.78rem", color: T.text, fontFamily: "JetBrains Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.xlsxName || r.name}
                  </span>
                </div>
                {r.error && <p style={{ fontSize: "0.7rem", color: T.bad,   marginTop: "0.2rem", marginLeft: 17 }}>{r.error}</p>}
                {r.isPartial && (
                  <p style={{ fontSize: "0.7rem", color: "#f59e0b", marginTop: "0.2rem", marginLeft: 17 }}>
                    {t.mismatchFound} {r.qty} / {r.expectedQty} {t.rows}
                  </p>
                )}
                {!r.error && !r.isPartial && r.qty && (
                  <p style={{ fontSize: "0.7rem", color: T.good, marginTop: "0.2rem", marginLeft: 17 }}>
                    ✓ {r.qty} {t.rows} · CHF {fmtCHF(r.total)}
                  </p>
                )}
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
        ))}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
        {successCount > 1 && (
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
