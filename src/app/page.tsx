"use client";

import { useEffect, useState } from "react";

interface Sub {
  name: string;
  amount: number;
  billDate: number;
  via: string;
}
interface AuditResult {
  count: number;
  totalMonthly: number;
  ollamaUsed: boolean;
  subscriptions: Sub[];
}
interface Settings {
  kordiBase: string;
  mcpConfigured: boolean;
  scanIntervalMinutes: number;
  enableAudio: boolean;
  excludeApps: string; // comma-joined for the input
  ollamaUrl: string;
  ollamaModel: string;
  minConfidence: number;
  maxIngestsPerRun: number;
}

const BLANK: Settings = {
  kordiBase: "https://kordiapp.com",
  mcpConfigured: false,
  scanIntervalMinutes: 60,
  enableAudio: false,
  excludeApps: "",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
  minConfidence: 0.6,
  maxIngestsPerRun: 10,
};

export default function Home() {
  const [cfg, setCfg] = useState<Settings>(BLANK);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const [savingMsg, setSavingMsg] = useState("");
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        setCfg({
          kordiBase: d.kordiBase ?? BLANK.kordiBase,
          mcpConfigured: Boolean(d.mcpConfigured),
          scanIntervalMinutes: d.scanIntervalMinutes ?? 60,
          enableAudio: Boolean(d.enableAudio),
          excludeApps: (d.excludeApps || []).join(", "),
          ollamaUrl: d.ollamaUrl ?? BLANK.ollamaUrl,
          ollamaModel: d.ollamaModel ?? BLANK.ollamaModel,
          minConfidence: d.minConfidence ?? 0.6,
          maxIngestsPerRun: d.maxIngestsPerRun ?? 10,
        });
      })
      .catch(() => setStatus("Could not load settings."))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof Settings>(k: K, v: Settings[K]) {
    setCfg((c) => ({ ...c, [k]: v }));
  }

  async function scan() {
    setScanning(true);
    setStatus("");
    try {
      const r = await fetch("/api/audit", { method: "POST" });
      const d = await r.json();
      if (d.ok) {
        setAudit({ count: d.count, totalMonthly: d.totalMonthly, ollamaUsed: d.ollamaUsed, subscriptions: d.subscriptions || [] });
      } else {
        setStatus(d.error || "Scan failed.");
      }
    } catch {
      setStatus("Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function signup() {
    if (!email) return;
    setSigningUp(true);
    setStatus("");
    try {
      const r = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!d.ok) {
        setStatus(d.error || "Signup failed.");
      } else if (d.status === "existing") {
        setStatus("That email already has a Kordi account — we emailed you a link to view your subscriptions.");
      } else {
        setCfg((c) => ({ ...c, mcpConfigured: true }));
        setStatus(`Synced ${d.imported} subscription${d.imported === 1 ? "" : "s"} ($${d.totalMonthly}/mo). Check your email to secure your account.`);
      }
    } catch {
      setStatus("Signup failed.");
    } finally {
      setSigningUp(false);
    }
  }

  async function syncNow() {
    setStatus("Syncing…");
    try {
      const r = await fetch("/api/run-now", { method: "POST" });
      const d = await r.json();
      setStatus(d.ok ? `Synced — ingested ${d.ingested}, updated ${d.updated}, skipped ${d.skipped}.` : d.error || "Sync failed.");
    } catch {
      setStatus("Sync failed.");
    }
  }

  async function saveSettings() {
    setSavingMsg("Saving…");
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kordiBase: cfg.kordiBase.trim(),
          scanIntervalMinutes: Number(cfg.scanIntervalMinutes),
          enableAudio: cfg.enableAudio,
          excludeApps: cfg.excludeApps,
          ollamaUrl: cfg.ollamaUrl.trim(),
          ollamaModel: cfg.ollamaModel.trim(),
          minConfidence: Number(cfg.minConfidence),
          maxIngestsPerRun: Number(cfg.maxIngestsPerRun),
        }),
      });
      setSavingMsg(r.ok ? "Saved." : "Save failed.");
    } catch {
      setSavingMsg("Save failed.");
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
      <p className="sub">Find subscriptions on your screen and track them in Kordi — no account needed to start.</p>

      <div className="card">
        <button className="btn-primary" onClick={scan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan my screen"}
        </button>
        {audit && (
          <div style={{ marginTop: 18 }}>
            <p style={{ fontSize: 18, fontWeight: 800, margin: "0 0 4px" }}>
              {audit.count} subscription{audit.count === 1 ? "" : "s"} · ${audit.totalMonthly}/mo
            </p>
            {!audit.ollamaUsed && <p className="note">LLM off — showing known services only. Start Ollama to catch more.</p>}
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
              {audit.subscriptions.map((s, i) => (
                <li
                  key={i}
                  style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}
                >
                  <span>{s.name}</span>
                  <span style={{ color: "var(--muted)" }}>${s.amount}/mo</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {cfg.mcpConfigured ? (
        <div className="card">
          <p style={{ fontWeight: 800, margin: "0 0 10px", color: "var(--violet-bright)" }}>Connected to Kordi ✓</p>
          <button className="btn-secondary" onClick={syncNow}>
            Sync now
          </button>
        </div>
      ) : (
        <div className="card">
          <label htmlFor="email">Create your Kordi account</label>
          <input id="email" type="text" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="note">We&apos;ll create a free account, import what we found, and email you a link to secure it.</p>
          <div className="actions">
            <button className="btn-primary" onClick={signup} disabled={signingUp || !email}>
              {signingUp ? "Creating…" : "Create my Kordi account & sync"}
            </button>
          </div>
        </div>
      )}

      <div className="status">{status}</div>

      <div className="card">
        <label>Detection &amp; connection settings</label>
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
            <label htmlFor="freq">Sync every (minutes)</label>
            <input id="freq" type="number" min={5} max={1440} value={cfg.scanIntervalMinutes} onChange={(e) => set("scanIntervalMinutes", Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="conf">Min confidence</label>
            <input id="conf" type="number" min={0} max={1} step={0.05} value={cfg.minConfidence} onChange={(e) => set("minConfidence", Number(e.target.value))} />
          </div>
        </div>
        <label htmlFor="exclude">Exclude apps (comma-separated)</label>
        <input id="exclude" type="text" placeholder="1password, banking" value={cfg.excludeApps} onChange={(e) => set("excludeApps", e.target.value)} />
        <label htmlFor="base">Kordi API base</label>
        <input id="base" type="text" value={cfg.kordiBase} onChange={(e) => set("kordiBase", e.target.value)} />
        <div className="check">
          <input id="audio" type="checkbox" checked={cfg.enableAudio} onChange={(e) => set("enableAudio", e.target.checked)} />
          <label htmlFor="audio">Also scan audio transcripts (off by default)</label>
        </div>
        <div className="actions">
          <button className="btn-secondary" onClick={saveSettings}>
            Save settings
          </button>
        </div>
        <div className="status">{savingMsg}</div>
        <p className="note">
          Privacy: Screenpipe scrubs card numbers before storage; this pipe reads only a service name, amount, and date — never card details.
        </p>
      </div>
    </main>
  );
}
