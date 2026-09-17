"use client";

import * as React from "react";
import { Trash2, Plus, AlertTriangle, Send, RotateCw, KeyRound, Webhook, SlidersHorizontal, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { CopyField } from "@/components/ui/copy-field";

type TabId = "pnl" | "keys" | "webhooks" | "docs";
const TABS: { id: TabId; label: string; Icon: typeof KeyRound }[] = [
  { id: "pnl", label: "P&L treatment", Icon: SlidersHorizontal },
  { id: "keys", label: "API keys", Icon: KeyRound },
  { id: "webhooks", label: "Outbound webhooks", Icon: Webhook },
  { id: "docs", label: "API reference", Icon: Terminal },
];

/** Header inside a settings content pane. */
const PaneHead = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div className="mb-3">
    <h2 className="text-[14px] font-bold text-foreground">{title}</h2>
    <p className="text-[12px] text-muted-foreground mt-0.5">{subtitle}</p>
  </div>
);

type ApiKey = {
  id: string; name: string; key_prefix: string; scopes: string[];
  created_at: string; last_used_at: string | null; revoked_at: string | null;
};
type WebhookEndpoint = {
  id: string; url: string; description: string | null; enabled: boolean;
  event_types: string[]; enabled_at: string; created_at: string;
};
type WebhookDelivery = {
  id: string; endpoint_id: string; event_id: string; transaction_id: string | null;
  event_type: string; status: string; attempts: number; response_code: number | null;
  last_error: string | null; delivered_at: string | null; next_attempt_at: string; created_at: string;
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

const inputCls = "h-9 px-3 rounded-lg border border-border bg-background text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 transition-all";
const primaryBtn = "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-primary text-primary-foreground text-[12.5px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const Lead = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">{children}</p>
);
const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[12px] text-muted-foreground/70 rounded-lg border border-dashed border-border py-4 text-center">{children}</p>
);

export function SettingsClient({ connectors }: { connectors: ConnectorToggle[] }) {
  const [conns, setConns] = React.useState<ConnectorToggle[]>(connectors);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [keys, setKeys] = React.useState<ApiKey[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [freshKey, setFreshKey] = React.useState<string | null>(null);
  const [origin, setOrigin] = React.useState("");
  const [tab, setTab] = React.useState<TabId>("pnl");

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
  const revoke = async (id: string) => { await fetch(`/api/settings/api-keys?id=${id}`, { method: "DELETE" }); await load(); };

  // ── Outbound webhooks ────────────────────────────────────────────
  const [endpoints, setEndpoints] = React.useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = React.useState<WebhookDelivery[]>([]);
  const [whLoading, setWhLoading] = React.useState(true);
  const [newUrl, setNewUrl] = React.useState("");
  const [newDesc, setNewDesc] = React.useState("");
  const [addingWh, setAddingWh] = React.useState(false);
  const [whError, setWhError] = React.useState<string | null>(null);
  const [freshSecret, setFreshSecret] = React.useState<string | null>(null);
  const [testMsg, setTestMsg] = React.useState<{ id: string; text: string; ok: boolean } | null>(null);

  const loadWebhooks = React.useCallback(async () => {
    setWhLoading(true);
    try {
      const [e, d] = await Promise.all([
        fetch("/api/webhooks/endpoints").then((r) => r.json()),
        fetch("/api/webhooks/deliveries").then((r) => r.json()),
      ]);
      setEndpoints(e.endpoints ?? []);
      setDeliveries(d.deliveries ?? []);
    } finally { setWhLoading(false); }
  }, []);
  React.useEffect(() => { void loadWebhooks(); }, [loadWebhooks]);

  const addEndpoint = async () => {
    setAddingWh(true); setWhError(null); setFreshSecret(null);
    try {
      const r = await fetch("/api/webhooks/endpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: newUrl, description: newDesc }) });
      const d = await r.json();
      if (!r.ok) { setWhError(d.error ?? "Could not add endpoint"); return; }
      setFreshSecret(d.secret); setNewUrl(""); setNewDesc("");
      await loadWebhooks();
    } finally { setAddingWh(false); }
  };
  const toggleEndpoint = async (id: string, enabled: boolean) => {
    setEndpoints((prev) => prev.map((e) => (e.id === id ? { ...e, enabled } : e)));
    const r = await fetch(`/api/webhooks/endpoints?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
    if (!r.ok) setEndpoints((prev) => prev.map((e) => (e.id === id ? { ...e, enabled: !enabled } : e)));
  };
  const removeEndpoint = async (id: string) => { await fetch(`/api/webhooks/endpoints?id=${id}`, { method: "DELETE" }); await loadWebhooks(); };
  const sendTest = async (id: string) => {
    setTestMsg({ id, text: "Sending…", ok: true });
    const r = await fetch(`/api/webhooks/endpoints/test?id=${id}`, { method: "POST" });
    const d = await r.json();
    setTestMsg({ id, text: d.ok ? `Delivered (HTTP ${d.status})` : `Failed: ${d.error ?? `HTTP ${d.status}`}`, ok: !!d.ok });
    setTimeout(() => setTestMsg((m) => (m?.id === id ? null : m)), 4000);
  };
  const retryDelivery = async (id: string) => { await fetch(`/api/webhooks/deliveries?id=${id}`, { method: "POST" }); await loadWebhooks(); };

  const updateConn = async (id: string, field: "include_income" | "include_expense", value: boolean) => {
    setConns((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: value } : c)));
    setSavingId(id);
    try {
      const r = await fetch(`/api/connectors/manage?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [field]: value }) });
      if (!r.ok) throw new Error();
    } catch {
      setConns((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: !value } : c)));
    } finally { setSavingId(null); }
  };

  const active = keys.filter((k) => !k.revoked_at);
  const curl = `curl -H "Authorization: Bearer <YOUR_KEY>" \\\n  "${origin}/api/v1/payments?search=customer@email.com"`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 items-start max-w-[960px]">
      {/* ── Left nav rail ────────────────────────────────────────── */}
      <nav className="rounded-xl border border-border bg-card p-2 flex md:flex-col gap-1 overflow-x-auto md:sticky md:top-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12.5px] transition-colors whitespace-nowrap flex-shrink-0",
              tab === t.id ? "bg-primary/10 text-primary font-semibold" : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <t.Icon className="h-4 w-4 flex-shrink-0" /> {t.label}
          </button>
        ))}
      </nav>

      {/* ── Content pane ─────────────────────────────────────────── */}
      <div className="min-w-0">
      {/* ── Connector P&L treatment ──────────────────────────────── */}
      {tab === "pnl" && (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <PaneHead title="Connector P&L treatment" subtitle="What each source contributes to Income & Expense" />
        <Lead>Choose whether each connector&apos;s money counts toward Income and Expense across the P&amp;L, Dashboard and Analytics. Both on by default — turning one off applies instantly.</Lead>
        {conns.length === 0 ? (
          <Empty>No connectors yet — add one on the Connectors page.</Empty>
        ) : (
          <div className="space-y-2">
            {conns.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-foreground truncate">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground/70">{CONNECTOR_TYPE_LABEL[c.type] ?? c.type}{c.status !== "active" ? ` · ${c.status}` : ""}</p>
                </div>
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className={cn(c.include_income ? "text-foreground" : "text-muted-foreground/50")}>Income</span>
                  <Switch checked={c.include_income} disabled={savingId === c.id} onChange={(v) => updateConn(c.id, "include_income", v)} aria-label={`${c.name} income`} />
                </div>
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span className={cn(c.include_expense ? "text-foreground" : "text-muted-foreground/50")}>Expense</span>
                  <Switch checked={c.include_expense} disabled={savingId === c.id} onChange={(v) => updateConn(c.id, "include_expense", v)} aria-label={`${c.name} expense`} />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground/60 leading-relaxed mt-3">
          <span className="font-medium text-muted-foreground">Income off</span> excludes that connector&apos;s revenue (captures + bank income) and its refunds/chargebacks. <span className="font-medium text-muted-foreground">Expense off</span> excludes its expense debits and payment-gateway fees.
        </p>
      </section>
      )}

      {/* ── API keys ─────────────────────────────────────────────── */}
      {tab === "keys" && (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <PaneHead title="API keys" subtitle="Read-only, search-only partner access to your payments" />
        <Lead>Give a partner system read-only, search access to your payments — no gateway setup on their side.</Lead>
        <div className="flex items-center gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Key name (e.g. Colleague's dashboard)" className={cn(inputCls, "flex-1")} />
          <button onClick={create} disabled={creating} className={primaryBtn}><Plus className="h-3.5 w-3.5" /> {creating ? "Creating…" : "Create key"}</button>
        </div>

        {freshKey && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Copy this key now — it won&apos;t be shown again.</div>
            <CopyField value={freshKey} />
          </div>
        )}

        <div className="mt-3 space-y-2">
          {loading ? <p className="text-[12px] text-muted-foreground">Loading…</p>
            : active.length === 0 ? <Empty>No API keys yet.</Empty>
            : active.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-foreground truncate">{k.name}</p>
                  <p className="text-[11px] text-muted-foreground/70 font-mono">{k.key_prefix}••••  ·  {k.scopes.join(", ")}  ·  {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleDateString("en-IN")}` : "never used"}</p>
                </div>
                <button onClick={() => revoke(k.id)} className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors" title="Revoke"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
        </div>
      </section>
      )}

      {/* ── Outbound webhooks ────────────────────────────────────── */}
      {tab === "webhooks" && (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <PaneHead title="Outbound webhooks" subtitle="Push payments to an external URL in real time" />
        <Lead>Push every payment (plus its refunds and status changes) to an external URL in real time — signed, retried, and auditable. Forward-only from when you add the endpoint.</Lead>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input value={newUrl} onChange={(e) => setNewUrl(e.target.value)} placeholder="https://colleague-dashboard.com/webhooks/finance-os" className={cn(inputCls, "flex-1")} />
            <button onClick={addEndpoint} disabled={addingWh || !newUrl.trim()} className={primaryBtn}><Plus className="h-3.5 w-3.5" /> {addingWh ? "Adding…" : "Add endpoint"}</button>
          </div>
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="Label (optional) — e.g. Colleague's dashboard" className={cn(inputCls, "w-full h-8")} />
          {whError && <p className="text-[11.5px] text-destructive">{whError}</p>}
        </div>

        {freshSecret && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> Signing secret — copy it now, it won&apos;t be shown again.</div>
            <CopyField value={freshSecret} />
            <p className="text-[11px] text-muted-foreground/70">Your colleague verifies each request: HMAC-SHA256 of <code className="text-foreground">&quot;&#123;t&#125;.&#123;body&#125;&quot;</code> with this secret, compared to the <code className="text-foreground">X-FinanceOS-Signature</code> header (<code className="text-foreground">t=&lt;unix&gt;,v1=&lt;hex&gt;</code>).</p>
          </div>
        )}

        <div className="mt-3 space-y-2">
          {whLoading ? <p className="text-[12px] text-muted-foreground">Loading…</p>
            : endpoints.length === 0 ? <Empty>No endpoints yet.</Empty>
            : endpoints.map((ep) => (
              <div key={ep.id} className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-foreground truncate">{ep.description || ep.url}</p>
                    {ep.description && <p className="text-[11px] text-muted-foreground/70 truncate font-mono">{ep.url}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11.5px]">
                    <span className={cn(ep.enabled ? "text-foreground" : "text-muted-foreground/50")}>{ep.enabled ? "Enabled" : "Paused"}</span>
                    <Switch checked={ep.enabled} onChange={(v) => toggleEndpoint(ep.id, v)} aria-label="endpoint enabled" />
                  </div>
                  <button onClick={() => sendTest(ep.id)} className="p-1.5 rounded-lg border border-border hover:bg-muted flex-shrink-0 transition-colors" title="Send test event"><Send className="h-3.5 w-3.5 text-muted-foreground" /></button>
                  <button onClick={() => removeEndpoint(ep.id)} className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 flex-shrink-0 transition-colors" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                {testMsg?.id === ep.id && <p className={cn("text-[11px]", testMsg.ok ? "text-emerald-600" : "text-destructive")}>{testMsg.text}</p>}
              </div>
            ))}
        </div>

        {deliveries.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">Recent deliveries</p>
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
              {deliveries.slice(0, 12).map((d) => (
                <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                  <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize flex-shrink-0",
                    d.status === "delivered" ? "bg-emerald-500/10 text-emerald-600" :
                    d.status === "dead" ? "bg-destructive/10 text-destructive" :
                    d.status === "failed" ? "bg-amber-500/10 text-amber-600" : "bg-muted text-muted-foreground")}>{d.status}</span>
                  <span className="text-muted-foreground font-mono flex-shrink-0">{d.event_type}</span>
                  <span className="text-muted-foreground/60 flex-1 truncate">{d.last_error ?? (d.response_code ? `HTTP ${d.response_code}` : "")}</span>
                  <span className="text-muted-foreground/50 tabular-nums flex-shrink-0">{new Date(d.created_at).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {(d.status === "failed" || d.status === "dead") && (
                    <button onClick={() => retryDelivery(d.id)} className="p-1 rounded hover:bg-muted flex-shrink-0" title="Retry now"><RotateCw className="h-3 w-3 text-muted-foreground" /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
      )}

      {/* ── Usage docs ───────────────────────────────────────────── */}
      {tab === "docs" && (
      <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <PaneHead title="Payments Search API" subtitle="Endpoint reference" />
        <Lead>Search-only, read-only, scoped to this organisation. Pass a <code className="text-foreground">search</code> term (order id, payment id, UTR/RRN, email, or phone — min 3 chars). Returns matching gateway payments with customer name/email/phone; no card data.</Lead>
        <div className="space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">Endpoint</p>
            <CopyField value={`${origin}/api/v1/payments?search=<term>&from=&to=&limit=100&offset=0`} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-1.5">Example</p>
            <pre className="text-[11px] rounded-lg bg-muted/50 border border-border px-2.5 py-2 text-foreground overflow-x-auto whitespace-pre font-mono">{curl}</pre>
          </div>
          <p className="text-[11px] text-muted-foreground/70">Send the key only from a server — never expose it in a browser or mobile app.</p>
        </div>
      </section>
      )}
      </div>
    </div>
  );
}
