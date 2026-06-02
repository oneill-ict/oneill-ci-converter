import React, { useState, useRef, useCallback } from "react";
import { Upload, FileText, Download, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
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

const STATUS = { idle: "idle", loading: "loading", done: "done", error: "error" };

export default function App() {
  const [status, setStatus]     = useState(STATUS.idle);
  const [message, setMessage]   = useState("");
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const inputRef = useRef(null);

  const convert = useCallback(async (file) => {
    if (!file || file.type !== "application/pdf") {
      setStatus(STATUS.error);
      setMessage("Upload een PDF-bestand.");
      return;
    }
    setFileName(file.name);
    setStatus(STATUS.loading);
    setMessage("PDF wordt verwerkt…");

    try {
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
        const err = await res.json().catch(() => ({ error: "Onbekende fout" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const exportName = file.name.replace(/\.[^.]+$/, "") + ".xlsx";
      a.href = url;
      a.download = exportName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus(STATUS.done);
      setMessage("Excel-bestand succesvol gedownload.");
    } catch (e) {
      setStatus(STATUS.error);
      setMessage(e.message || "Er is iets misgegaan bij het verwerken van de PDF.");
    }
  }, []);

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) convert(file);
    e.target.value = "";
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) convert(file);
  };

  const onDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const reset = () => { setStatus(STATUS.idle); setMessage(""); setFileName(""); };

  const isLoading = status === STATUS.loading;

  return (
    <div style={{ minHeight: "100vh", background: T.bgGradient, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", position: "relative", overflow: "hidden" }}>
      <Wave />

      {/* Logo / wordmark */}
      <div style={{ marginBottom: "2.5rem", textAlign: "center", animation: "fadeIn 0.3s ease-out" }}>
        <div style={{ fontFamily: "Fraunces, serif", fontSize: "1.5rem", fontWeight: 700, color: T.text, letterSpacing: "-0.02em", marginBottom: "0.25rem" }}>
          O'Neill
        </div>
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: "0.75rem", fontWeight: 500, color: T.textDim, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Commercial Invoice Converter
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          background: T.panel,
          border: `1px solid ${dragging ? T.brand : T.line}`,
          borderRadius: 20,
          padding: "2.5rem",
          width: "100%",
          maxWidth: 480,
          position: "relative",
          zIndex: 1,
          transition: "border-color 0.2s",
          animation: "fadeIn 0.3s ease-out 0.1s both",
          boxShadow: dragging ? `0 0 0 3px ${T.brandSoft}` : "none",
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
      >
        {status === STATUS.idle && (
          <UploadZone dragging={dragging} onPickFile={() => inputRef.current?.click()} />
        )}
        {status === STATUS.loading && (
          <LoadingState />
        )}
        {status === STATUS.done && (
          <DoneState fileName={fileName} onReset={reset} />
        )}
        {status === STATUS.error && (
          <ErrorState message={message} onReset={reset} />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={onFileChange}
      />

      <p style={{ marginTop: "1.5rem", fontSize: "0.7rem", color: T.textGhost, fontFamily: "JetBrains Mono, monospace", zIndex: 1 }}>
        PDF → XLSX · Geen login vereist · Geen data opgeslagen
      </p>
    </div>
  );
}

function UploadZone({ dragging, onPickFile }) {
  return (
    <div
      onClick={onPickFile}
      style={{ cursor: "pointer", textAlign: "center" }}
    >
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: dragging ? T.brandSoft : T.panelDeep,
        border: `1px solid ${dragging ? T.brand : T.lineHi}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 1.5rem",
        transition: "all 0.2s",
      }}>
        <Upload size={28} color={dragging ? T.brand : T.textMute} />
      </div>

      <p style={{ fontFamily: "Inter, sans-serif", fontSize: "1rem", fontWeight: 600, color: T.text, marginBottom: "0.5rem" }}>
        {dragging ? "Loslaten om te uploaden" : "Upload Commercial Invoice PDF"}
      </p>
      <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.75rem", lineHeight: 1.5 }}>
        Sleep een PDF hierheen of klik om te bladeren
      </p>

      <button
        type="button"
        style={{
          background: T.brand,
          color: "#071520",
          border: "none",
          borderRadius: 10,
          padding: "0.625rem 1.5rem",
          fontFamily: "Inter, sans-serif",
          fontWeight: 600,
          fontSize: "0.875rem",
          cursor: "pointer",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
        onMouseLeave={e => e.currentTarget.style.opacity = "1"}
      >
        Kies bestand
      </button>

      <p style={{ marginTop: "1.5rem", fontSize: "0.72rem", color: T.textGhost, lineHeight: 1.6 }}>
        Ondersteunde structuur: O'Neill Commercial Invoice<br />
        Output: Excel (.xlsx) met tariefsubtotalen
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ textAlign: "center", padding: "1rem 0" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}>
        <Loader2 size={40} color={T.brand} style={{ animation: "spin 1s linear infinite" }} />
      </div>
      <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>PDF wordt verwerkt…</p>
      <p style={{ fontSize: "0.8rem", color: T.textDim }}>Factuurregels extraheren en Excel opbouwen</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function DoneState({ fileName, onReset }) {
  return (
    <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: T.goodSoft, border: `1px solid ${T.good}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 1.5rem",
      }}>
        <CheckCircle2 size={30} color={T.good} />
      </div>
      <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>Download gestart</p>
      <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.75rem" }}>
        {fileName && <span style={{ color: T.textMute, fontFamily: "JetBrains Mono, monospace", fontSize: "0.75rem" }}>{fileName}</span>}
        {fileName && <br />}
        Excel-bestand is opgeslagen in je downloadmap.
      </p>
      <button
        type="button"
        onClick={onReset}
        style={{
          background: T.lineHi, color: T.text, border: `1px solid ${T.line}`,
          borderRadius: 10, padding: "0.5rem 1.25rem",
          fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: "0.85rem",
          cursor: "pointer",
        }}
      >
        Nieuwe factuur converteren
      </button>
    </div>
  );
}

function ErrorState({ message, onReset }) {
  return (
    <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
      <div style={{
        width: 64, height: 64, borderRadius: "50%",
        background: T.badSoft, border: `1px solid ${T.bad}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        margin: "0 auto 1.5rem",
      }}>
        <AlertCircle size={30} color={T.bad} />
      </div>
      <p style={{ fontWeight: 600, color: T.text, marginBottom: "0.4rem" }}>Verwerking mislukt</p>
      <p style={{ fontSize: "0.8rem", color: T.textDim, marginBottom: "1.75rem", lineHeight: 1.5 }}>
        {message}
      </p>
      <button
        type="button"
        onClick={onReset}
        style={{
          background: T.lineHi, color: T.text, border: `1px solid ${T.line}`,
          borderRadius: 10, padding: "0.5rem 1.25rem",
          fontFamily: "Inter, sans-serif", fontWeight: 500, fontSize: "0.85rem",
          cursor: "pointer",
        }}
      >
        Opnieuw proberen
      </button>
    </div>
  );
}
