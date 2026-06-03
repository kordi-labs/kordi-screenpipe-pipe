"use client";

import { useEffect, useState } from "react";

interface Config {
  mcpUrl: string;
  scanIntervalMinutes: number;
  enableAudio: boolean;
  excludeApps: string[] | string;
  ollamaUrl: string;
  ollamaModel: string;
  minConfidence: number;
  maxIngestsPerRun: number;
}

const BLANK: Config = {
  mcpUrl: "",
  scanIntervalMinutes: 60,
  enableAudio: false,
  excludeApps: "",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  minConfidence: 0.6,
  maxIngestsPerRun: 10,
};

export default function Home() {
  const [cfg, setCfg] = useState<Config>(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: Config & { excludeApps: string[] }) => {
        setCfg({ ...d, excludeApps: (d.excludeApps || []).join(", ") });
      })
      .catch(() => setStatus("Could not load settings."))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof Config>(key: K, value: Config[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setStatus("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcpUrl: cfg.mcpUrl.trim(),
          scanIntervalMinutes: Number(cfg.scanIntervalMinutes),
          enableAudio: cfg.enableAudio,
          excludeApps: String(cfg.excludeApps),
          ollamaUrl: cfg.ollamaUrl.trim(),
          ollamaModel: cfg.ollamaModel.trim(),
          minConfidence: Number(cfg.minConfidence),
          maxIngestsPerRun: Number(cfg.maxIngestsPerRun),
        }),
      });
      setStatus(res.ok ? "Settings saved." : "Save failed.");
    } catch {
      setStatus("Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function runNow() {
    setRunning(true);
    setStatus("Scanning…");
    try {
      const res = await fetch("/api/run-now", { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        setStatus(
          `Scan done — scanned ${d.scanned}, detected ${d.detected}, ingested ${d.ingested}, updated ${d.updated}, skipped ${d.skipped}. LLM: ${d.ollamaUsed ? "on" : "off (catalog only)"}.`,
        );
      } else {
        setStatus(`Scan: ${d.error || "failed"}.`);
      }
    } catch {
      setStatus("Scan failed.");
    } finally {
      setRunning(false);
    }
  }

  if (loading) {
    return (
      <main>
        <p className="sub">Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Kordi Subscription Finder</h1>
      <p className="sub">
        Spots subscriptions on your screen and tracks them in Kordi — complementary to email-based discovery.
      </p>

      <div className="card">
        <label htmlFor="mcpUrl">Kordi Connect link</label>
        <input
          id="mcpUrl"
          type="text"
          placeholder="https://kordiapp.com/mcp?token=screenpipe_…"
          value={cfg.mcpUrl}
          onChange={(e) => set("mcpUrl", e.target.value)}
        />
        <p className="note">
          In Kordi, open the dashboard → <strong>Connect Screenpipe</strong> → Generate, then paste the link here.
        </p>

        <div className="row">
          <div>
            <label htmlFor="model">Ollama model</label>
            <input id="model" type="text" value={cfg.ollamaModel} onChange={(e) => set("ollamaModel", e.target.value)} />
          </div>
          <div>
            <label htmlFor="ourl">Ollama URL</label>
            <input id="ourl" type="text" value={cfg.ollamaUrl} onChange={(e) => set("ollamaUrl", e.target.value)} />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="freq">Scan every (minutes)</label>
            <input
              id="freq"
              type="number"
              min={5}
              max={1440}
              value={cfg.scanIntervalMinutes}
              onChange={(e) => set("scanIntervalMinutes", Number(e.target.value))}
            />
          </div>
          <div>
            <label htmlFor="conf">Min confidence (0–1)</label>
            <input
              id="conf"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={cfg.minConfidence}
              onChange={(e) => set("minConfidence", Number(e.target.value))}
            />
          </div>
        </div>

        <label htmlFor="exclude">Exclude apps (comma-separated)</label>
        <input
          id="exclude"
          type="text"
          placeholder="1password, banking"
          value={String(cfg.excludeApps)}
          onChange={(e) => set("excludeApps", e.target.value)}
        />

        <div className="check">
          <input
            id="audio"
            type="checkbox"
            checked={cfg.enableAudio}
            onChange={(e) => set("enableAudio", e.target.checked)}
          />
          <label htmlFor="audio">Also scan audio transcripts (off by default)</label>
        </div>

        <p className="note">
          Privacy: Screenpipe scrubs card numbers before storage; this pipe only reads a service name, amount, and date —
          never card details.
        </p>

        <div className="actions">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button className="btn-secondary" onClick={runNow} disabled={running || !cfg.mcpUrl}>
            {running ? "Scanning…" : "Run scan now"}
          </button>
        </div>

        <div className="status">{status}</div>
      </div>
    </main>
  );
}
