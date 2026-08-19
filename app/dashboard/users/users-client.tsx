"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  UserPlus, X, RefreshCw, Shield, Wrench, Eye, Mail, User, Trash2, Settings2, Check, Building2, Copy, KeyRound,
  History, Search as SearchIcon, Download as DownloadIcon, ShieldCheck, LogIn, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GRANTABLE_PAGES } from "@/lib/org/pages";

// ─── Constants ────────────────────────────────────────────────────────────────

// Derived from the canonical page registry (lib/org/pages.ts) so any page added
// there appears here for selection automatically. `pii` flags customer-data pages.
export const PAGE_OPTIONS = GRANTABLE_PAGES.map((p) => ({ value: p.slug, label: p.label, pii: !!p.pii }));

export type Role = "admin" | "manager" | "viewer";

const ROLE_META: Record<Role, { label: string; desc: string; Icon: typeof Shield }> = {
  admin:   { label: "Admin",   desc: "Full access + manage team",  Icon: Shield },
  manager: { label: "Manager", desc: "View & edit selected pages",  Icon: Wrench },
  viewer:  { label: "Viewer",  desc: "Read-only, selected pages",   Icon: Eye },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgMember {
  id:            string;
  org_id:        string;
  invited_email: string;
  user_id:       string | null;
  full_name:     string | null;
  role:          Role;
  page_access:   string[];
  payments_search_only?: boolean;
  status:        "pending" | "active" | "revoked";
  created_at:    string;
}

export interface OrgGroup {
  org:     { id: string; name: string };
  members: OrgMember[];
}

// Response of POST /api/users — a member row plus one-time credentials.
type CreateResponse = OrgMember & {
  created: boolean;
  credentials: { email: string; password: string } | null;
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function Avatar({ name, email }: { name: string | null; email: string }) {
  const letter = (name?.trim() || email).charAt(0).toUpperCase();
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold text-white flex-shrink-0"
      style={{ background: "linear-gradient(135deg, #2a3a6f, #0f1628)" }}
    >
      {letter}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const { label, Icon } = ROLE_META[role];
  const styles: Record<Role, string> = {
    admin:   "bg-primary/[0.12] text-primary border-primary/20",
    manager: "bg-amber-500/[0.10] text-amber-700 dark:text-amber-400 border-amber-500/20",
    viewer:  "bg-blue-500/[0.10] text-blue-700 dark:text-blue-400 border-blue-500/15",
  };
  return (
    <span className={cn("flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border", styles[role])}>
      <Icon className="w-2.5 h-2.5" /> {label}
    </span>
  );
}

function PageChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "text-[9.5px] font-medium px-1.5 py-0.5 rounded",
        active ? "bg-emerald-500/[0.12] text-success/80" : "bg-accent/40 text-muted-foreground/70 line-through"
      )}
    >
      {label}
    </span>
  );
}

/** A read-only credential field with a one-click copy button. */
function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div>
      <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg text-[13px] text-foreground bg-accent/60 border border-border font-mono">
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          title={copied ? "Copied!" : "Copy"}
          className="flex-shrink-0 p-2 rounded-lg text-muted-foreground/70 hover:text-primary hover:bg-accent transition-all"
        >
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

// ─── Create / Edit dialog ─────────────────────────────────────────────────────

interface MemberDialogProps {
  mode:    "create" | "edit";
  orgId:   string;
  orgName: string;
  member?: OrgMember;
  onClose: () => void;
  onSaved: (orgId: string, member: OrgMember) => void;
}

function MemberDialog({ mode, orgId, orgName, member, onClose, onSaved }: MemberDialogProps) {
  const [fullName,   setFullName]   = React.useState(member?.full_name ?? "");
  const [email,      setEmail]      = React.useState(member?.invited_email ?? "");
  const [role,       setRole]       = React.useState<Role>(member?.role ?? "viewer");
  const [pageAccess, setPageAccess] = React.useState<string[]>(
    member?.page_access ?? ["dashboard", "revenue", "cashflow"]
  );
  // Search-only Payments (support/calling teams): they can look up a payment but
  // never browse the whole book. Only meaningful for restricted members with
  // Payments access.
  const [searchOnlyPay, setSearchOnlyPay] = React.useState<boolean>(member?.payments_search_only ?? false);
  const [saving, setSaving] = React.useState(false);
  // Once a user is created, show their credentials instead of the form.
  const [credentials, setCredentials] = React.useState<{ email: string; password: string } | null>(null);

  // Admins implicitly get all pages; viewers/managers use the explicit list.
  const restrictsPages  = role !== "admin";
  const effectiveAccess = role === "admin" ? PAGE_OPTIONS.map((p) => p.value) : pageAccess;
  // Search-only only applies to a restricted member who actually has Payments.
  const canSearchOnly       = restrictsPages && effectiveAccess.includes("data");
  const paymentsSearchOnly  = canSearchOnly && searchOnlyPay;

  function togglePage(value: string) {
    if (!restrictsPages) return;
    setPageAccess((prev) => (prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]));
  }
  function toggleAll() {
    if (!restrictsPages) return;
    setPageAccess((prev) => (prev.length === PAGE_OPTIONS.length ? [] : PAGE_OPTIONS.map((p) => p.value)));
  }

  const handleSave = async () => {
    if (mode === "create" && (!email.trim() || !email.includes("@"))) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            org_id: orgId, email: email.trim(), full_name: fullName.trim() || null,
            role, page_access: effectiveAccess,
            payments_search_only: paymentsSearchOnly,
          }),
        });
      } else {
        res = await fetch(`/api/users/${member!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, page_access: effectiveAccess, payments_search_only: paymentsSearchOnly }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");

      if (mode === "edit") {
        onSaved(orgId, data as OrgMember);
        toast.success("Permissions updated");
        onClose();
        return;
      }

      // Create: update the list, then either show credentials or close.
      const resp = data as CreateResponse;
      onSaved(orgId, resp);
      if (resp.credentials) {
        setCredentials(resp.credentials);
      } else {
        // Existing account linked to the org — no new password to share.
        toast.success("Added — they can sign in with their existing password.");
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const title = credentials ? "User created" : mode === "create" ? "Create Team Member" : "Edit Permissions";

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-[201] w-[calc(100vw-32px)] max-w-[460px] bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none"
          style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
              {/* In edit mode, show WHO is being edited (avatar + name + email). */}
              {mode === "edit" && member && !credentials && (
                <Avatar name={member.full_name} email={member.invited_email} />
              )}
              <div className="min-w-0">
                <Dialog.Title className="text-[14px] font-semibold text-foreground truncate">
                  {mode === "edit" && member && !credentials
                    ? (member.full_name?.trim() || member.invited_email)
                    : title}
                </Dialog.Title>
                {mode === "edit" && member && !credentials ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70 mt-0.5 truncate">
                    <Mail className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{member.invited_email}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <Building2 className="w-3 h-3 flex-shrink-0" /> <span className="truncate">{orgName}</span>
                  </p>
                ) : (
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70 mt-0.5">
                    <Building2 className="w-3 h-3" /> {orgName}
                  </p>
                )}
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {credentials ? (
            /* ── Credentials view (shown once) ─────────────────────────────── */
            <>
              <div className="px-5 py-4 space-y-4">
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20">
                  <KeyRound className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                    Account ready. <span className="font-semibold text-foreground">Copy these now</span> and share them
                    securely — the password is shown only once. They&apos;ll be asked to set their own password on first login.
                  </p>
                </div>
                <CopyField label="Email" value={credentials.email} />
                <CopyField label="Temporary Password" value={credentials.password} />
              </div>
              <div className="flex gap-2.5 px-5 pb-5 pt-2">
                <Button className="flex-1" onClick={onClose}>Done</Button>
              </div>
            </>
          ) : (
            /* ── Form view ─────────────────────────────────────────────────── */
            <>
              <div className="px-5 py-4 space-y-4">
                {/* Name + Email (create only) */}
                {mode === "create" && (
                  <>
                    <div>
                      <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
                        Full Name <span className="font-medium text-muted-foreground/50 normal-case tracking-normal">(optional)</span>
                      </label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
                        <input
                          type="text"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Jane Doe"
                          autoFocus
                          className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] text-muted-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/30"
                          style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
                        Email Address
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleSave()}
                          placeholder="colleague@company.com"
                          className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] text-muted-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/30"
                          style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Role */}
                <div>
                  <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
                    Role
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(ROLE_META) as Role[]).map((r) => {
                      const active = role === r;
                      const { label, desc, Icon } = ROLE_META[r];
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRole(r)}
                          className="flex flex-col items-start px-2.5 py-2.5 rounded-xl transition-all text-left"
                          style={{
                            background: active ? "rgba(124,82,240,0.10)" : "hsl(var(--accent))",
                            border: `1px solid ${active ? "rgba(124,82,240,0.30)" : "hsl(var(--border))"}`,
                          }}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Icon className={cn("w-3 h-3", active ? "text-primary" : "text-muted-foreground/70")} />
                            <span className={cn("text-[12px] font-semibold", active ? "text-foreground" : "text-muted-foreground")}>
                              {label}
                            </span>
                          </div>
                          <span className="text-[9.5px] leading-tight text-muted-foreground/70">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Page access */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">
                      Page Access
                    </label>
                    {restrictsPages && (
                      <button
                        type="button"
                        onClick={toggleAll}
                        className="text-[10px] text-primary/70 hover:text-primary transition-colors"
                      >
                        {pageAccess.length === PAGE_OPTIONS.length ? "Deselect all" : "Select all"}
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PAGE_OPTIONS.map(({ value, label }) => {
                      const on = effectiveAccess.includes(value);
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => togglePage(value)}
                          disabled={!restrictsPages}
                          className={cn(
                            "flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all disabled:cursor-default",
                            on ? "bg-emerald-500/[0.08] border border-emerald-500/20"
                               : "bg-accent/40 border border-border hover:bg-accent",
                            !restrictsPages && "opacity-60"
                          )}
                        >
                          <div className={cn(
                            "w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border",
                            on ? "bg-emerald-500/20 border-emerald-500/40" : "border-border"
                          )}>
                            {on && <Check className="w-2 h-2 text-success" />}
                          </div>
                          <span className={cn("text-[11.5px] font-medium", on ? "text-muted-foreground" : "text-muted-foreground/70")}>
                            {label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {!restrictsPages && (
                    <p className="text-[10.5px] text-muted-foreground/70 mt-1.5">Admins always have access to all pages.</p>
                  )}
                  {role === "manager" && (
                    <p className="text-[10.5px] text-muted-foreground/70 mt-1.5">Managers can view and edit data on the selected pages.</p>
                  )}

                  {/* Search-only Payments sub-toggle — shown when a restricted member
                      has Payments access. Turns Payments into a lookup-only tool. */}
                  {canSearchOnly && (
                    <button
                      type="button"
                      onClick={() => setSearchOnlyPay((v) => !v)}
                      className={cn(
                        "mt-2.5 w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all border",
                        searchOnlyPay ? "bg-primary/[0.06] border-primary/25" : "bg-accent/40 border-border hover:bg-accent"
                      )}
                    >
                      <div className={cn(
                        "mt-0.5 w-8 h-[18px] rounded-full flex-shrink-0 relative transition-colors",
                        searchOnlyPay ? "bg-primary" : "bg-muted-foreground/25"
                      )}>
                        <span className={cn(
                          "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all",
                          searchOnlyPay ? "left-[15px]" : "left-0.5"
                        )} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11.5px] font-semibold text-foreground">Payments: search-only</p>
                        <p className="text-[10.5px] text-muted-foreground/70 leading-snug mt-0.5">
                          No transaction list or totals — they must search (name, email, phone, order/UTR/payment ID)
                          to look up a specific payment. Ideal for support / calling teams.
                        </p>
                      </div>
                    </button>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex gap-2.5 px-5 pb-5 pt-2">
                <Dialog.Close asChild>
                  <Button variant="outline" className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving}>
                  {saving
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {mode === "create" ? "Creating…" : "Saving…"}</>
                    : mode === "create" ? "Create User" : "Save Changes"}
                </Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Bulk add dialog (paste → per-user grid → credentials) ────────────────────

const DEFAULT_PAGES = ["dashboard", "revenue", "cashflow"];

type DraftRow = {
  email: string; full_name: string; role: Role;
  page_access: string[]; payments_search_only: boolean; existing: boolean;
};

type BulkResult = {
  email: string; ok: boolean; created?: boolean;
  credentials?: { email: string; password: string } | null;
  member?: OrgMember; error?: string;
};

/** Compact page-access checklist used in the defaults bar and per-row editors. */
function PagePicker({ value, onChange, disabled }: { value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const allOn = value.length === PAGE_OPTIONS.length;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <button type="button" disabled={disabled}
          onClick={() => onChange(allOn ? [] : PAGE_OPTIONS.map((p) => p.value))}
          className="text-[10px] text-primary/70 hover:text-primary transition-colors disabled:opacity-50">
          {allOn ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {PAGE_OPTIONS.map(({ value: v, label }) => {
          const on = value.includes(v);
          return (
            <button key={v} type="button" disabled={disabled}
              onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}
              className={cn(
                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left transition-all disabled:opacity-50",
                on ? "bg-emerald-500/[0.08] border border-emerald-500/20" : "bg-accent/40 border border-border hover:bg-accent"
              )}>
              <div className={cn("w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border", on ? "bg-emerald-500/20 border-emerald-500/40" : "border-border")}>
                {on && <Check className="w-2 h-2 text-success" />}
              </div>
              <span className={cn("text-[11px] font-medium", on ? "text-muted-foreground" : "text-muted-foreground/70")}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BulkAddDialog({
  orgId, orgName, existingEmails, onClose, onSaved,
}: {
  orgId: string; orgName: string; existingEmails: string[];
  onClose: () => void; onSaved: (orgId: string, members: OrgMember[]) => void;
}) {
  const existing = React.useMemo(() => new Set(existingEmails.map((e) => e.toLowerCase())), [existingEmails]);
  const [step, setStep] = React.useState<"input" | "review" | "results">("input");
  const [raw, setRaw] = React.useState("");
  const [rows, setRows] = React.useState<DraftRow[]>([]);
  const [defRole, setDefRole] = React.useState<Role>("viewer");
  const [defPages, setDefPages] = React.useState<string[]>(DEFAULT_PAGES);
  const [showDefPages, setShowDefPages] = React.useState(false);
  const [openPagesFor, setOpenPagesFor] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [results, setResults] = React.useState<BulkResult[]>([]);
  const [copiedAll, setCopiedAll] = React.useState(false);

  const parse = () => {
    const seen = new Set<string>();
    const out: DraftRow[] = [];
    let invalid = 0, dup = 0;
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[,\t]/);
      const email = (parts[0] ?? "").trim().toLowerCase();
      const name = parts.slice(1).join(",").trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { invalid++; continue; }
      if (seen.has(email)) { dup++; continue; }
      seen.add(email);
      out.push({ email, full_name: name, role: defRole, page_access: defPages, payments_search_only: false, existing: existing.has(email) });
    }
    if (out.length === 0) { toast.error("No valid emails found"); return; }
    setRows(out);
    setStep("review");
    if (invalid || dup) toast.message(`${out.length} recipients · ${invalid} invalid, ${dup} duplicate skipped`);
  };

  const patchRow = (email: string, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.email === email ? { ...r, ...patch } : r)));
  const removeRow = (email: string) => setRows((prev) => prev.filter((r) => r.email !== email));
  const applyToAll = () =>
    setRows((prev) => prev.map((r) => (r.existing ? r : { ...r, role: defRole, page_access: defPages })));

  const addable = rows.filter((r) => !r.existing);

  const submit = async () => {
    if (addable.length === 0) { toast.error("Nothing to add — all are already members"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/users/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          users: addable.map((r) => ({
            email: r.email,
            full_name: r.full_name || null,
            role: r.role,
            page_access: r.role === "admin" ? PAGE_OPTIONS.map((p) => p.value) : r.page_access,
            payments_search_only: r.role !== "admin" && r.page_access.includes("data") && r.payments_search_only,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const rs = (data.results ?? []) as BulkResult[];
      setResults(rs);
      const added = rs.filter((r) => r.ok && r.member).map((r) => r.member as OrgMember);
      if (added.length) onSaved(orgId, added);
      setStep("results");
      toast.success(`${data.added} added${data.failed ? `, ${data.failed} skipped` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const createdCreds = results.filter((r) => r.ok && r.credentials);
  const copyAll = async () => {
    const text = createdCreds.map((r) => `${r.credentials!.email}\t${r.credentials!.password}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1400); } catch { /* clipboard unavailable */ }
  };

  const roleSelect = (r: DraftRow) => (
    <select
      value={r.role}
      onChange={(e) => patchRow(r.email, { role: e.target.value as Role })}
      className="text-[11px] rounded-lg px-2 py-1.5 bg-accent border border-border text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
    >
      {(Object.keys(ROLE_META) as Role[]).map((v) => <option key={v} value={v}>{ROLE_META[v].label}</option>)}
    </select>
  );

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-[201] w-[calc(100vw-32px)] max-w-[600px] max-h-[86vh] flex flex-col bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none"
          style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
            <div className="min-w-0">
              <Dialog.Title className="text-[14px] font-semibold text-foreground">
                {step === "results" ? "Users created" : "Add Team Members"}
              </Dialog.Title>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70 mt-0.5">
                <Building2 className="w-3 h-3" /> {orgName}
                {step === "review" && <span className="text-muted-foreground/40">· {rows.length} recipient{rows.length !== 1 ? "s" : ""}</span>}
              </p>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* ── Step: paste emails ──────────────────────────────────────────── */}
          {step === "input" && (
            <>
              <div className="px-5 py-4 space-y-4 overflow-y-auto">
                <div>
                  <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
                    Emails <span className="font-medium text-muted-foreground/50 normal-case tracking-normal">— one per line (optional: <code>email, Full Name</code>)</span>
                  </label>
                  <textarea
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    autoFocus
                    rows={7}
                    placeholder={"alice@company.com, Alice Sharma\nbob@company.com\ncarol@company.com"}
                    className="w-full px-3 py-2.5 rounded-lg text-[13px] text-muted-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30 font-mono leading-relaxed resize-y"
                    style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">Default role</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(Object.keys(ROLE_META) as Role[]).map((r) => {
                      const active = defRole === r;
                      const { label, desc, Icon } = ROLE_META[r];
                      return (
                        <button key={r} type="button" onClick={() => setDefRole(r)}
                          className="flex flex-col items-start px-2.5 py-2 rounded-xl transition-all text-left"
                          style={{ background: active ? "rgba(124,82,240,0.10)" : "hsl(var(--accent))", border: `1px solid ${active ? "rgba(124,82,240,0.30)" : "hsl(var(--border))"}` }}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <Icon className={cn("w-3 h-3", active ? "text-primary" : "text-muted-foreground/70")} />
                            <span className={cn("text-[12px] font-semibold", active ? "text-foreground" : "text-muted-foreground")}>{label}</span>
                          </div>
                          <span className="text-[9.5px] leading-tight text-muted-foreground/70">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {defRole !== "admin" && (
                  <div>
                    <button type="button" onClick={() => setShowDefPages((v) => !v)}
                      className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 hover:text-muted-foreground transition-colors">
                      Default page access · {defPages.length} <span className="text-primary/70 normal-case tracking-normal font-medium">{showDefPages ? "hide" : "edit"}</span>
                    </button>
                    {showDefPages && <div className="mt-2"><PagePicker value={defPages} onChange={setDefPages} /></div>}
                  </div>
                )}
                <p className="text-[10.5px] text-muted-foreground/70">
                  You&apos;ll review each person and can change their role/pages individually on the next step.
                </p>
              </div>
              <div className="flex gap-2.5 px-5 pb-5 pt-2 border-t border-border">
                <Dialog.Close asChild>
                  <Button variant="outline" className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border">Cancel</Button>
                </Dialog.Close>
                <Button className="flex-1 gap-2" onClick={parse} disabled={!raw.trim()}>Continue →</Button>
              </div>
            </>
          )}

          {/* ── Step: review grid ───────────────────────────────────────────── */}
          {step === "review" && (
            <>
              {/* Apply-to-all bar */}
              <div className="px-5 py-3 border-b border-border bg-accent/30 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">Apply to all:</span>
                <select value={defRole} onChange={(e) => setDefRole(e.target.value as Role)}
                  className="text-[11px] rounded-lg px-2 py-1 bg-popover border border-border text-muted-foreground focus:outline-none">
                  {(Object.keys(ROLE_META) as Role[]).map((v) => <option key={v} value={v}>{ROLE_META[v].label}</option>)}
                </select>
                {defRole !== "admin" && (
                  <button type="button" onClick={() => setShowDefPages((v) => !v)}
                    className="text-[11px] px-2 py-1 rounded-lg bg-popover border border-border text-muted-foreground hover:bg-accent transition-colors">
                    Pages · {defPages.length}
                  </button>
                )}
                <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 border-border bg-transparent" onClick={applyToAll}>
                  <Check className="w-3 h-3" /> Apply
                </Button>
              </div>
              {showDefPages && defRole !== "admin" && (
                <div className="px-5 py-3 border-b border-border"><PagePicker value={defPages} onChange={setDefPages} /></div>
              )}

              <div className="px-5 py-3 overflow-y-auto space-y-1.5">
                {rows.map((r) => (
                  <div key={r.email} className={cn("rounded-xl border px-3 py-2.5", r.existing ? "border-amber-500/20 bg-amber-500/[0.04]" : "border-border bg-accent/40")}>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-muted-foreground truncate flex items-center gap-1.5">
                          {r.email}
                          {r.existing && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/[0.12] text-warning/80 border border-amber-500/20">already a member</span>}
                        </p>
                        {!r.existing && (
                          <input
                            value={r.full_name}
                            onChange={(e) => patchRow(r.email, { full_name: e.target.value })}
                            placeholder="Full name (optional)"
                            className="mt-1 w-full px-2 py-1 rounded-md text-[11px] text-muted-foreground placeholder:text-muted-foreground/50 bg-popover border border-border focus:outline-none focus:ring-1 focus:ring-primary/30"
                          />
                        )}
                      </div>
                      {!r.existing && (
                        <>
                          {roleSelect(r)}
                          {r.role !== "admin" && (
                            <button type="button" onClick={() => setOpenPagesFor(openPagesFor === r.email ? null : r.email)}
                              className="text-[11px] px-2 py-1.5 rounded-lg bg-popover border border-border text-muted-foreground hover:bg-accent transition-colors whitespace-nowrap">
                              {r.page_access.length} pages
                            </button>
                          )}
                        </>
                      )}
                      <button type="button" onClick={() => removeRow(r.email)} title="Remove"
                        className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-red-500/[0.08] transition-all">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {openPagesFor === r.email && r.role !== "admin" && !r.existing && (
                      <div className="mt-2.5 pt-2.5 border-t border-border">
                        <PagePicker value={r.page_access} onChange={(next) => patchRow(r.email, { page_access: next })} />
                        {r.page_access.includes("data") && (
                          <button type="button" onClick={() => patchRow(r.email, { payments_search_only: !r.payments_search_only })}
                            className={cn("mt-2 flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg border transition-all",
                              r.payments_search_only ? "bg-primary/[0.06] border-primary/25 text-foreground" : "bg-accent/40 border-border text-muted-foreground")}>
                            <div className={cn("w-3.5 h-3.5 rounded flex items-center justify-center border", r.payments_search_only ? "bg-primary/20 border-primary/40" : "border-border")}>
                              {r.payments_search_only && <Check className="w-2 h-2 text-primary" />}
                            </div>
                            Payments: search-only
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2.5 px-5 pb-5 pt-3 border-t border-border">
                <Button variant="outline" className="flex-1 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border" onClick={() => setStep("input")}>← Back</Button>
                <Button className="flex-1 gap-2" onClick={submit} disabled={saving || addable.length === 0}>
                  {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Creating…</> : `Add ${addable.length} user${addable.length !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </>
          )}

          {/* ── Step: results / credentials ─────────────────────────────────── */}
          {step === "results" && (
            <>
              <div className="px-5 py-4 overflow-y-auto space-y-3">
                {createdCreds.length > 0 && (
                  <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/20">
                    <KeyRound className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                    <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                      <span className="font-semibold text-foreground">Copy these now</span> and share them securely — passwords are shown only once. Each teammate sets their own on first login.
                    </p>
                  </div>
                )}
                {results.map((r) => (
                  <div key={r.email} className={cn("rounded-lg border px-3 py-2.5", r.ok ? "border-border bg-accent/40" : "border-red-500/20 bg-red-500/[0.04]")}>
                    <p className="text-[12px] font-medium text-muted-foreground truncate">{r.email}</p>
                    {r.ok && r.credentials ? (
                      <div className="mt-1.5 flex items-center gap-2">
                        <code className="flex-1 min-w-0 truncate px-2.5 py-1.5 rounded-md text-[12px] text-foreground bg-popover border border-border font-mono">{r.credentials.password}</code>
                        <button type="button" title="Copy password"
                          onClick={() => navigator.clipboard.writeText(r.credentials!.password).catch(() => {})}
                          className="flex-shrink-0 p-1.5 rounded-lg text-muted-foreground/70 hover:text-primary hover:bg-accent transition-all">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : r.ok ? (
                      <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">Added — signs in with their existing password.</p>
                    ) : (
                      <p className="text-[10.5px] text-destructive/80 mt-0.5">{r.error}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2.5 px-5 pb-5 pt-3 border-t border-border">
                {createdCreds.length > 0 && (
                  <Button variant="outline" className="flex-1 gap-2 border-border bg-transparent text-muted-foreground hover:text-muted-foreground hover:bg-accent hover:border-border" onClick={copyAll}>
                    {copiedAll ? <><Check className="w-3.5 h-3.5 text-success" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy all</>}
                  </Button>
                )}
                <Button className="flex-1" onClick={onClose}>Done</Button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Activity dialog ────────────────────────────────────────────────────────

type ActivityEvent = {
  id: string;
  action: string;
  actor_email: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  target_member_id: string | null;
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

const ACTION_META: Record<string, { label: string; Icon: typeof History; tone: string }> = {
  search:            { label: "Searched Payments",   Icon: SearchIcon,   tone: "text-blue-600 dark:text-blue-400" },
  export:            { label: "Exported CSV",         Icon: DownloadIcon, tone: "text-amber-600 dark:text-amber-400" },
  permission_change: { label: "Permissions changed",  Icon: ShieldCheck,  tone: "text-primary" },
  member_added:      { label: "Added to organisation", Icon: UserPlus,    tone: "text-success" },
  member_removed:    { label: "Removed from org",      Icon: Trash2,      tone: "text-destructive" },
};

function ActivityDialog({ member, onClose }: { member: OrgMember; onClose: () => void }) {
  const [loading, setLoading] = React.useState(true);
  const [lastSignInAt, setLastSignInAt] = React.useState<string | null>(null);
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = new URLSearchParams({ org_id: member.org_id, member_id: member.id });
        if (member.user_id) p.set("user_id", member.user_id);
        const res = await fetch(`/api/activity?${p}`);
        const data = await res.json();
        if (cancelled) return;
        setLastSignInAt(data.lastSignInAt ?? null);
        setEvents(Array.isArray(data.events) ? data.events : []);
      } catch { /* ignore */ } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [member]);

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-[201] w-[calc(100vw-32px)] max-w-[480px] max-h-[82vh] flex flex-col bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none"
          style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={member.full_name} email={member.invited_email} />
              <div className="min-w-0">
                <Dialog.Title className="text-[14px] font-semibold text-foreground truncate">
                  {member.full_name?.trim() || member.invited_email}
                </Dialog.Title>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">Activity &amp; usage</p>
              </div>
            </div>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 overflow-y-auto">
            {/* Last login */}
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-accent/40 border border-border mb-4">
              <LogIn className="w-4 h-4 text-muted-foreground/70 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70">Last login</p>
                <p className="text-[12.5px] font-medium text-foreground">
                  {member.status === "pending" ? "Never — invite not yet accepted" : lastSignInAt ? fmtWhen(lastSignInAt) : "Never signed in"}
                </p>
              </div>
            </div>

            <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 mb-2">Recent activity</p>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground/70 text-[12.5px]">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : events.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Clock className="w-5 h-5 text-muted-foreground/40" />
                <p className="text-[12.5px] text-muted-foreground/70">No recorded activity yet.</p>
                <p className="text-[11px] text-muted-foreground/50">Searches, exports and permission changes will appear here.</p>
              </div>
            ) : (
              <div className="space-y-1">
                {events.map((e) => {
                  const meta = ACTION_META[e.action] ?? { label: e.action, Icon: History, tone: "text-muted-foreground" };
                  const q = e.meta && typeof e.meta.q === "string" ? (e.meta.q as string) : null;
                  const rows = e.meta && typeof e.meta.rows === "number" ? (e.meta.rows as number) : null;
                  return (
                    <div key={e.id} className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors">
                      <meta.Icon className={cn("w-3.5 h-3.5 mt-0.5 flex-shrink-0", meta.tone)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] text-foreground">
                          {meta.label}
                          {q && <span className="text-muted-foreground"> — “{q}”</span>}
                          {rows !== null && <span className="text-muted-foreground"> — {rows.toLocaleString("en-IN")} rows</span>}
                        </p>
                        <p className="text-[10.5px] text-muted-foreground/60 mt-0.5">
                          {fmtWhen(e.created_at)}
                          {e.action === "permission_change" && e.actor_email ? ` · by ${e.actor_email}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({
  member, onEdit, onRevoke, selected, onToggleSelect,
}: {
  member: OrgMember;
  onEdit: (m: OrgMember) => void;
  onRevoke: (orgId: string, id: string) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [revoking, setRevoking] = React.useState(false);
  const [showActivity, setShowActivity] = React.useState(false);

  const doRevoke = async () => {
    if (!confirm(`Remove ${member.invited_email} from this organisation?`)) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/users/${member.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast.success("Access revoked");
      onRevoke(member.org_id, member.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRevoking(false);
    }
  };

  const isPending = member.status === "pending";

  return (
    <div className={cn(
      "flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all",
      isPending ? "border-amber-500/15 bg-amber-500/[0.03]" : "border-border bg-accent/40",
      selected && "ring-1 ring-primary/40 border-primary/30"
    )}>
      <button
        type="button"
        onClick={() => onToggleSelect(member.id)}
        title={selected ? "Deselect" : "Select"}
        aria-pressed={selected}
        className={cn(
          "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all",
          selected ? "bg-primary border-primary" : "border-border hover:border-primary/50"
        )}
      >
        {selected && <Check className="w-2.5 h-2.5 text-white" />}
      </button>
      <Avatar name={member.full_name} email={member.invited_email} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12.5px] font-medium text-muted-foreground truncate">
            {member.full_name || member.invited_email.split("@")[0]}
          </p>
          <RoleBadge role={member.role} />
          {isPending && (
            <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/[0.12] text-warning/80 border border-amber-500/20">
              Pending
            </span>
          )}
        </div>
        <p className="text-[10.5px] text-muted-foreground/70 mt-0.5 truncate">{member.invited_email}</p>

        <div className="flex flex-wrap gap-1 mt-1.5">
          {member.role === "admin"
            ? <span className="text-[9.5px] text-muted-foreground/70 font-medium">All pages</span>
            : PAGE_OPTIONS.map(({ value, label }) => (
                <PageChip key={value} label={label} active={member.page_access.includes(value)} />
              ))}
          {member.payments_search_only && (
            <span className="flex items-center gap-1 text-[9.5px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
              <SearchIcon className="w-2.5 h-2.5" /> Payments: search-only
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={() => setShowActivity(true)}
          title="Activity & usage"
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all"
        >
          <History className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => onEdit(member)}
          title="Edit permissions"
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-all"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={doRevoke}
          disabled={revoking}
          title="Revoke access"
          className="p-1.5 rounded-lg text-muted-foreground/70 hover:text-destructive hover:bg-red-500/[0.08] transition-all"
        >
          {revoking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {showActivity && <ActivityDialog member={member} onClose={() => setShowActivity(false)} />}
    </div>
  );
}

// ─── Per-org section ──────────────────────────────────────────────────────────

function OrgSection({
  group, onCreate, onEdit, onRevoke, onBulkRevoke,
}: {
  group: OrgGroup;
  onCreate: (orgId: string, orgName: string) => void;
  onEdit: (m: OrgMember) => void;
  onRevoke: (orgId: string, id: string) => void;
  onBulkRevoke: (orgId: string, ids: string[]) => void;
}) {
  const active  = group.members.filter((m) => m.status === "active");
  const pending = group.members.filter((m) => m.status === "pending");
  const ordered = [...active, ...pending];

  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [removing, setRemoving] = React.useState(false);

  // Drop selections that no longer exist (after a removal/refresh).
  React.useEffect(() => {
    setSelected((prev) => {
      const live = new Set(group.members.map((m) => m.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [group.members]);

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = ordered.length > 0 && selected.size === ordered.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ordered.map((m) => m.id)));

  const removeSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} member${ids.length !== 1 ? "s" : ""} from ${group.org.name}?`)) return;
    setRemoving(true);
    try {
      const res = await fetch("/api/users/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_ids: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      const revoked: string[] = data.revoked ?? [];
      onBulkRevoke(group.org.id, revoked);
      setSelected(new Set());
      const failed = (data.failed ?? []).length;
      toast.success(`Removed ${revoked.length}${failed ? `, ${failed} failed` : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid hsl(var(--border))" }}>
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: "hsl(var(--accent))", borderBottom: "1px solid hsl(var(--border))" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="w-3.5 h-3.5 text-muted-foreground/70 flex-shrink-0" />
          <span className="text-[13px] font-semibold text-foreground truncate">{group.org.name}</span>
          <span className="text-[10px] text-muted-foreground/70 font-mono">
            {active.length} active{pending.length ? ` · ${pending.length} pending` : ""}
          </span>
        </div>
        <Button size="sm" className="gap-1.5 h-7 text-[11px]" onClick={() => onCreate(group.org.id, group.org.name)}>
          <UserPlus className="w-3 h-3" /> Add Users
        </Button>
      </div>

      {/* Bulk-selection toolbar */}
      {selected.size > 0 && (
        <div className="px-4 py-2 flex items-center justify-between bg-primary/[0.05] border-b border-primary/15">
          <span className="text-[11px] font-medium text-foreground">{selected.size} selected</span>
          <div className="flex items-center gap-1.5">
            <button onClick={toggleAll} className="text-[11px] text-primary/80 hover:text-primary px-2 py-1 transition-colors">
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <Button size="sm" onClick={removeSelected} disabled={removing}
              className="h-7 text-[11px] gap-1.5 bg-red-500/10 text-destructive border border-red-500/20 hover:bg-red-500/20">
              {removing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
              Remove selected
            </Button>
          </div>
        </div>
      )}

      <div className="p-3 space-y-1.5">
        {group.members.length === 0 ? (
          <p className="text-[12px] text-muted-foreground/70 text-center py-4">
            No members yet — add users for {group.org.name}
          </p>
        ) : (
          ordered.map((m) => (
            <MemberRow key={m.id} member={m} onEdit={onEdit} onRevoke={onRevoke}
              selected={selected.has(m.id)} onToggleSelect={toggle} />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UsersClient({ groups: initialGroups }: { groups: OrgGroup[] }) {
  const [groups, setGroups] = React.useState<OrgGroup[]>(initialGroups);
  const [adding, setAdding] = React.useState<{ orgId: string; orgName: string } | null>(null);
  const [editing, setEditing] = React.useState<OrgMember | null>(null);

  const orgNameFor = (orgId: string) => groups.find((g) => g.org.id === orgId)?.org.name ?? "";
  const existingEmailsFor = (orgId: string) =>
    (groups.find((g) => g.org.id === orgId)?.members ?? []).map((m) => m.invited_email);

  function handleSaved(orgId: string, updated: OrgMember) {
    setGroups((prev) => prev.map((g) => {
      if (g.org.id !== orgId) return g;
      const idx = g.members.findIndex((m) => m.id === updated.id);
      return {
        ...g,
        members: idx >= 0
          ? g.members.map((m) => (m.id === updated.id ? updated : m))
          : [...g.members, updated],
      };
    }));
  }

  // Merge many added/linked members into a group (upsert by id).
  function handleBulkSaved(orgId: string, added: OrgMember[]) {
    if (added.length === 0) return;
    setGroups((prev) => prev.map((g) => {
      if (g.org.id !== orgId) return g;
      const byId = new Map(g.members.map((m) => [m.id, m]));
      for (const m of added) byId.set(m.id, m);
      return { ...g, members: [...byId.values()] };
    }));
  }

  function handleRevoked(orgId: string, id: string) {
    setGroups((prev) => prev.map((g) =>
      g.org.id === orgId ? { ...g, members: g.members.filter((m) => m.id !== id) } : g
    ));
  }

  function handleBulkRevoked(orgId: string, ids: string[]) {
    const drop = new Set(ids);
    setGroups((prev) => prev.map((g) =>
      g.org.id === orgId ? { ...g, members: g.members.filter((m) => !drop.has(m.id)) } : g
    ));
  }

  return (
    <>
      <div>
        <h1 className="text-[18px] font-bold text-foreground tracking-tight">Team</h1>
        <p className="text-[12px] text-muted-foreground/70 mt-0.5">
          Create users for any organisation you manage and control their role &amp; page access
        </p>
      </div>

      <div className="space-y-4">
        {groups.map((g) => (
          <OrgSection
            key={g.org.id}
            group={g}
            onCreate={(orgId, orgName) => setAdding({ orgId, orgName })}
            onEdit={(m) => setEditing(m)}
            onRevoke={handleRevoked}
            onBulkRevoke={handleBulkRevoked}
          />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        Adding users creates ready-to-use accounts — share the passwords shown, and they&apos;ll set their own on first login.
      </p>

      {adding && (
        <BulkAddDialog
          orgId={adding.orgId}
          orgName={adding.orgName}
          existingEmails={existingEmailsFor(adding.orgId)}
          onClose={() => setAdding(null)}
          onSaved={handleBulkSaved}
        />
      )}

      {editing && (
        <MemberDialog
          mode="edit"
          orgId={editing.org_id}
          orgName={orgNameFor(editing.org_id)}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
