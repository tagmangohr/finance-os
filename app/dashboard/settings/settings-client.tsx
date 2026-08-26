"use client";

import * as React from "react";
import { Copy, Check, Trash2, Plus, KeyRound, AlertTriangle, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

type ApiKey = {
  id: string; name: string; key_prefix: string; scopes: string[];
  created_at: string; last_used_at: string | null; revoked_at: string | null;
};

export type ConnectorToggle = {
  id: string; name: string; type: string; status: string;
  include_income: boolean; include_expense: boolean;
};

const CONNECTOR_TYPE_LABEL: Record<string, string> = {
  razorpay: "Razorpay", stripe: "Stripe", cashfree: "Cashfree", payu: "PayU",
  paytm: "Paytm", easebuzz: "Easebuzz", app_store: "Apple App Store", mercury: "Mercury",
  brex: "Brex", google_sheets: "Google Sheet", excel: "Excel", csv: "CSV",
  bank_statement: "Bank statement", zoho: "Zoho", quickbooks: "QuickBooks", tally: "Tally",
};

/** Small pill switch (no shared Switch component in the repo). */
function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-primary" : "bg-muted-foreground/30"
      )}
    >
      <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}

function Copyable({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <code className="flex-1 min-w-0 text-[11px] break-all rounded bg-background/60 border border-border px-2 py-1.5 text-foreground select-all">{value}</code>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
        className="p-1.5 rounded-lg border border-border hover:bg-muted flex-shrink-0" title="Copy">
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}

export function SettingsClient({ connectors }: { connectors: ConnectorToggle[] }) {
  const [conns, setConns] = React.useState<ConnectorToggle[]>(connectors);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<ApiKey[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [freshKey, setFreshKey] = React.useState<string | null>(null); // plaintext, shown once
  const [origin, setOrigin] = React.useState("");

  React.useEffect(() => { setOrigin(window.location.origin); }, []);
  const load = React.useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/settings/api-keys"); const d = await r.json(); setKeys(d.keys ?? []); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const create = async () => {
    setCreating(true); setFreshKey(null);
    try {
      const r = await fetch("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName || "API key" }) });
      const d = await r.json();
      if (d.key) { setFreshKey(d.key); setNewName(""); await load(); }
    } finally { setCreating(false); }
  };
  const revoke = async (id: string) => {
    await fetch(`/api/settings/api-keys?id=${id}`, { method: "DELETE" });
    await load();
  };

  // Flip one connector's income/expense switch. Optimistic; reverts on failure.
  const updateConn = async (id: string, field: "include_income" | "include_expense", value: boolean) => {
    setConns((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    setSavingId(id);
    try {
      const r = await fetch(`/api/connectors/manage?id=${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setConns((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: !value } : c)));
    } finally {
      setSavingId(null);
    }
  };

  const active = keys.filter((k) => !k.revoked_at);
  const curl = `curl -H "Authorization: Bearer <YOUR_KEY>" \\\n  "${origin}/api/v1/payments?search=customer@email.com"`;

  return (
    <div className="space-y-6">
      {/* ── Connector P&L treatment ──────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-[14px] font-semibold text-foreground">Connector P&amp;L treatment</h2>
            <p className="text-[12px] text-muted-foreground/80">Choose whether each connector&apos;s money counts toward Income and Expense across the P&amp;L, Dashboard and Analytics. Both on by default — turning one off applies instantly.</p>
          </div>
        </div>
        <div className="space-y-2">
          {conns.length === 0 && <p className="text-[12px] text-muted-foreground/70">No connectors yet. Add one on the Connectors page.</p>}
          {conns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-accent/30 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-foreground truncate">{c.name}</p>
                <p className="text-[11px] text-muted-foreground/70">{CONNECTOR_TYPE_LABEL[c.type] ?? c.type}{c.status !== "active" ? ` · ${c.status}` : ""}</p>
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <span className={cn("tabular-nums", c.include_income ? "text-foreground" : "text-muted-foreground/50")}>Income</span>
                <Switch checked={c.include_income} disabled={savingId === c.id} onChange={(v) => updateConn(c.id, "include_income", v)} />
              </div>
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <span className={cn("tabular-nums", c.include_expense ? "text-foreground" : "text-muted-foreground/50")}>Expense</span>
                <Switch checked={c.include_expense} disabled={savingId === c.id} onChange={(v) => updateConn(c.id, "include_expense", v)} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
          <span className="font-medium">Income off</span> excludes that connector&apos;s revenue (captures + bank income) and its refunds/chargebacks. <span className="font-medium">Expense off</span> excludes its expense debits and payment-gateway fees.
        </p>
      </section>

      {/* ── API keys ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div>
              <h2 className="text-[14px] font-semibold text-foreground">API keys</h2>
              <p className="text-[12px] text-muted-foreground/80">Give a partner system read-only, search access to your payments — no gateway setup on their side.</p>
            </div>
          </div>
        </div>

        {/* create */}
        <div className="flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Key name (e.g. Colleague's dashboard)"
            className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-[12.5px] focus:outline-none focus:border-primary" />
          <button onClick={create} disabled={creating}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-[12.5px] font-medium hover:bg-primary/90 disabled:opacity-60">
            <Plus className="h-3.5 w-3.5" /> {creating ? "Creating…" : "Create key"}
          </button>
        </div>

        {/* freshly created key — shown once */}
        {freshKey && (
          <div className="rounded-lg border border-warning/30 bg-warning/[0.06] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Copy this key now — it won&apos;t be shown again.
            </div>
            <Copyable value={freshKey} />
          </div>
        )}

        {/* list */}
        <div className="space-y-2">
          {loading && <p className="text-[12px] text-muted-foreground">Loading…</p>}
          {!loading && active.length === 0 && <p className="text-[12px] text-muted-foreground/70">No API keys yet.</p>}
          {active.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-lg border border-border bg-accent/30 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-foreground truncate">{k.name}</p>
                <p className="text-[11px] text-muted-foreground/70 font-mono">{k.key_prefix}••••  ·  {k.scopes.join(", ")}  ·  {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString("en-IN")}` : "never used"}</p>
              </div>
              <button onClick={() => revoke(k.id)} className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10" title="Revoke">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Usage docs ───────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-[14px] font-semibold text-foreground">Payments Search API</h2>
        <p className="text-[12px] text-muted-foreground/80 leading-relaxed">
          Search-only, read-only, scoped to this organisation. Pass a <code className="text-foreground">search</code> term (order id, payment id, UTR/RRN, email, or phone — min 3 chars). Returns matching gateway payments with customer name/email/phone; no card data.
        </p>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Endpoint</p>
          <Copyable value={`${origin}/api/v1/payments?search=<term>&from=&to=&limit=100&offset=0`} />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Example</p>
          <pre className="text-[11px] rounded bg-background/60 border border-border px-2 py-2 text-foreground overflow-x-auto whitespace-pre">{curl}</pre>
        </div>
        <p className="text-[11px] text-muted-foreground/70">Send the key only from a server — never expose it in a browser or mobile app.</p>
      </section>
    </div>
  );
}
