import React, { useState, useRef, useCallback } from "react";
import { Upload, CheckCircle2, AlertCircle, Loader2, FileDown, Archive } from "lucide-react";
import JSZip from "jszip";
import { T } from "./lib/theme.js";

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

async function convertFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);

  const res = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf: base64, filename: file.name }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const qty   = parseInt(res.headers.get("X-Validation-Qty")   || "0", 10);
  const total = parseFloat(res.headers.get("X-Validation-Total") || "0");
  const blob  = await res.blob();
  return { blob, qty, total };
}

export default function App() {
  const [phase, setPhase]       = useState("idle");   // idle | processing | done
  const [progress, setProgress] = useState({ i: 0, total: 0, name: "" });
  const [results, setResults]   = useState([]);        // [{name, xlsxName, blob, qty, total, error}]
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  const runBatch = useCallback(async (files) => {
    if (!files.length) return;
    const pdfs = [...files].filter(f => f.type === "application/pdf");
    if (!pdfs.length) return;

    setPhase("processing");
    setResults([]);

    const batch = [];
    for (let i = 0; i < pdfs.length; i++) {
      const file = pdfs[i];
      setProgress({ i: i + 1, total: pdfs.length, name: file.name });
      try {
        const { blob, qty, total } = await convertFile(file);
        const xlsxName = file.name.replace(/\.[^.]+$/, "") + ".xlsx";
        // Single file: trigger download immediately
        if (pdfs.length === 1) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = xlsxName;
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        }
        batch.push({ name: file.name, xlsxName, blob, qty, total, error: null });
      } catch (e) {
        batch.push({ name: file.name, xlsxName: null, blob: null, qty: null, total: null, error: e.message });
      }
    }

    setResults(batch);
    setPhase("done");
  }, []);

  const downloadZip = async () => {
    const zip = new JSZip();
    for (const r of results) {
      if (r.blob) zip.file(r.xlsxName, r.blob);
    }
    const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url; a.download = "commercial-invoices.zip";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadSingle = (r) => {
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement("a");
    a.href = url; a.download = r.xlsxName;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const reset = () => { setPhase("idle"); setResults([]); setProgress({ i: 0, total: 0, name: "" }); };

  const onFileChange = (e) => { if (e.target.files?.length) runBatch(e.target.files); e.target.value = ""; };
  const onDrop = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files?.length) runBatch(e.dataTransfer.files); };
  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const successCount = results.filter(r => !r.error).length;
  const errorCount   = results.filter(r =>  r.error).length;

  return (
    <div style={{ minHeight: "100vh", background: T.bgGradient, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", position: "relative", overflow: "hidden" }}>
      <Wave />

      <div style={{ marginBottom: "2.5rem", textAlign: "center", animation: "fadeIn 0.3s ease-out" }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: "1.5rem", fontWeight: 700, color: T.text, letterSpacing: "-0.02em", marginBottom: "0.25rem" }}>
          O'Neill
        </div>
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: "0.75rem", fontWeight: 500, color: T.textDim, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Commercial Invoice Converter
        </div>
      </div>

      <div
        style={{
          background: T.panel, border: `1px solid ${dragging ? T.brand : T.line}`, borderRadius: 20,
          padding: "2.5rem", width: "100%",
          maxWidth: phase === "done" && results.length > 1 ? 560 : 480,
          position: "relative", zIndex: 1, transition: "all 0.2s",
          animation: "fadeIn 0.3s ease-out 0.1s both",
          boxShadow: dragging ? `0 0 0 3px ${T.brandSoft}` : "none",
        }}
        onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}
      >
        {phase === "idle" && (
          <UploadZone dragging={dragging} onPickFile={() => inputRef.current?.click()} />
        )}
        {phase === "processing" && (
          <ProcessingState progress={progress} />
        )}
        {phase === "done" && results.length === 1 && (
          <SingleDoneState result={results[0]} onReset={reset} onRedownload={() => downloadSingle(results[0])} />
        )}
        {phase === "done" && results.length > 1 && (
          <BatchDoneState results={results} successCount={successCount} errorCount={errorCount}
            onDownloadZip={downloadZip} onDownloadSingle={downloadSingle} onReset={reset} />
        )}
      </div>

      <input ref={inputRef} type="file" accept="application/pdf" multiple style={{ display: "none" }} onChange={onFileChange} />

      <p style={{ marginTop: "1.5rem", fontSize: "0.7rem", color: T.textGhost, fontFamily: "JetBrains Mono, monospace", zIndex: 1 }}>
        PDF → XLSX · Geen login vereist · Geen data opgeslagen
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeIn { from { opacity:0; transform: translateY(6px); } to { opacity:1; transform: translateY(0); } }`}</style>
    </div>
  );
}

function UploadZone({ dragging, onPickFile }) {
  return (
    <div onClick={onPickFile} style={{ cursor: "pointer", textAlign: "center" }}>
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
        {dragging ? "Loslaten om te uploaden" : "Upload Commercial Invoice PDF"}
      </p>
      <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.75rem", lineHeight: 1.5 }}>
        Sleep een of meerdere PDF's hierheen of klik om te bladeren
      </p>
      <button type="button" style={{
        background: T.brand, color: "#071520", border: "none", borderRadius: 10,
        padding: "0.625rem 1.5rem", fontFamily: "Inter, sans-serif",
        fontWeight: 600, fontSize: "0.875rem", cursor: "pointer", transition: "opacity 0.15s",
      }}
        onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
      >
        Kies bestand(en)
      </button>
      <p style={{ marginTop: "1.5rem", fontSize: "0.72rem", color: T.textGhost, lineHeight: 1.6 }}>
        Ondersteunde structuur: O'Neill Commercial Invoice<br />
        Output: Excel (.xlsx) met tariefsubtotalen
      </p>
    </div>
  );
}

function ProcessingState({ progress }) {
  const pct = progress.total > 0 ? Math.round((progress.i - 1) / progress.total * 100) : 0;
  return (
    <div style={{ textAlign: "center", padding: "1rem 0" }}>
      <Loader2 size={40} color={T.brand} style={{ animation: "spin 1s linear infinite", marginBottom: "1.5rem" }} />
      {progress.total > 1 && (
        <>
          <p style={{ fontSize: "0.75rem", color: T.textDim, marginBottom: "0.5rem" }}>
            Bestand {progress.i} van {progress.total}
          </p>
          <div style={{ background: T.panelDeep, borderRadius: 99, height: 4, marginBottom: "1rem", overflow: "hidden" }}>
            <div style={{ background: T.brand, height: "100%", width: `${pct}%`, transition: "width 0.3s" }} />
          </div>
        </>
      )}
      <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>PDF wordt verwerkt…</p>
      <p style={{ fontSize: "0.8rem", color: T.textDim, fontFamily: "JetBrains Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 320, margin: "0 auto" }}>
        {progress.name}
      </p>
    </div>
  );
}

function ValidationBadge({ qty, total }) {
  if (!qty) return null;
  return (
    <div style={{
      background: T.goodSoft, border: `1px solid ${T.good}`, borderRadius: 10,
      padding: "0.6rem 1rem", marginBottom: "1.5rem", display: "inline-flex",
      flexDirection: "column", alignItems: "center", gap: "0.2rem", minWidth: 200,
    }}>
      <span style={{ fontSize: "0.72rem", color: T.good, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        ✓ Validatie geslaagd
      </span>
      <span style={{ fontSize: "0.85rem", color: T.text, fontWeight: 600 }}>
        {qty} regels · CHF {fmtCHF(total)}
      </span>
    </div>
  );
}

function SingleDoneState({ result, onReset, onRedownload }) {
  return (
    <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: result.error ? T.badSoft : T.goodSoft,
        border: `1px solid ${result.error ? T.bad : T.good}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 1.5rem",
      }}>
        {result.error
          ? <AlertCircle size={30} color={T.bad} />
          : <CheckCircle2 size={30} color={T.good} />}
      </div>

      {result.error ? (
        <>
          <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>Verwerking mislukt</p>
          <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.75rem", lineHeight: 1.5 }}>{result.error}</p>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.75rem" }}>Download gestart</p>
          <ValidationBadge qty={result.qty} total={result.total} />
          <p style={{ fontSize: "0.75rem", color: T.textMute, fontFamily: "JetBrains Mono, monospace", marginBottom: "1.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {result.xlsxName}
          </p>
          <button type="button" onClick={onRedownload} style={{
            background: T.panelDeep, color: T.textMute, border: `1px solid ${T.line}`,
            borderRadius: 10, padding: "0.45rem 1rem", fontFamily: "Inter, sans-serif",
            fontWeight: 500, fontSize: "0.8rem", cursor: "pointer", marginBottom: "0.75rem",
            display: "inline-flex", alignItems: "center", gap: "0.4rem",
          }}>
            <FileDown size={14} /> Opnieuw downloaden
          </button>
          <br />
        </>
      )}

      <button type="button" onClick={onReset} style={{
        background: T.lineHi, color: T.text, border: `1px solid ${T.line}`,
        borderRadius: 10, padding: "0.5rem 1.25rem",
        fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: "0.85rem", cursor: "pointer",
      }}>
        Nieuwe factuur converteren
      </button>
    </div>
  );
}

function BatchDoneState({ results, successCount, errorCount, onDownloadZip, onDownloadSingle, onReset }) {
  return (
    <div style={{ padding: "0.5rem 0" }}>
      {/* Summary bar */}
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: errorCount === 0 ? T.goodSoft : T.badSoft,
          border: `1px solid ${errorCount === 0 ? T.good : T.bad}`,
          display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem",
        }}>
          {errorCount === 0
            ? <CheckCircle2 size={26} color={T.good} />
            : <AlertCircle size={26} color={T.bad} />}
        </div>
        <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.25rem" }}>
          {successCount} van {results.length} bestanden verwerkt
        </p>
        {errorCount > 0 && (
          <p style={{ fontSize: "0.8rem", color: T.bad }}>{errorCount} bestand{errorCount > 1 ? "en" : ""} mislukt</p>
        )}
      </div>

      {/* Per-file results */}
      <div style={{ marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {results.map((r, i) => (
          <div key={i} style={{
            background: T.panelDeep, border: `1px solid ${r.error ? T.bad : T.line}`,
            borderRadius: 10, padding: "0.65rem 0.9rem",
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem",
          }}>
            <div style={{ minWidth: 0 }}>
              {r.error
                ? <AlertCircle size={14} color={T.bad} style={{ verticalAlign: "middle", marginRight: 6 }} />
                : <CheckCircle2 size={14} color={T.good} style={{ verticalAlign: "middle", marginRight: 6 }} />}
              <span style={{ fontSize: "0.78rem", color: T.text, fontFamily: "JetBrains Mono, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.xlsxName || r.name}
              </span>
              {r.error && (
                <p style={{ fontSize: "0.7rem", color: T.bad, marginTop: "0.2rem", marginLeft: 20 }}>{r.error}</p>
              )}
              {!r.error && r.qty && (
                <p style={{ fontSize: "0.7rem", color: T.good, marginTop: "0.2rem", marginLeft: 20 }}>
                  ✓ {r.qty} regels · CHF {fmtCHF(r.total)}
                </p>
              )}
            </div>
            {!r.error && (
              <button type="button" onClick={() => onDownloadSingle(r)} style={{
                background: "transparent", color: T.textMute, border: `1px solid ${T.line}`,
                borderRadius: 8, padding: "0.3rem 0.6rem", cursor: "pointer", flexShrink: 0,
                display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.75rem",
              }}>
                <FileDown size={13} /> Download
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
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
            <Archive size={16} /> Download alle als ZIP
          </button>
        )}
        <button type="button" onClick={onReset} style={{
          background: T.lineHi, color: T.text, border: `1px solid ${T.line}`,
          borderRadius: 10, padding: "0.6rem 1.25rem",
          fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: "0.875rem", cursor: "pointer",
        }}>
          Nieuwe facturen
        </button>
      </div>
    </div>
  );
}
