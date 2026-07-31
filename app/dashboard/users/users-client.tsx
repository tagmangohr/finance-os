"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  UserPlus, X, RefreshCw, Shield, Wrench, Eye, Mail, User, Trash2, Settings2, Check, Building2, Copy, KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAGE_OPTIONS = [
  { value: "dashboard",    label: "War Room" },
  { value: "revenue",      label: "Revenue" },
  { value: "cashflow",     label: "Cash Flow" },
  { value: "collections",  label: "Collections" },
  { value: "intelligence", label: "Intelligence" },
  { value: "connectors",   label: "Connectors" },
  { value: "data",         label: "Payments" },
] as const;

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
    admin:   "bg-violet-500/[0.12] text-violet-400 border-violet-500/20",
    manager: "bg-amber-500/[0.10] text-warning/90 border-amber-500/20",
    viewer:  "bg-blue-500/[0.10] text-blue-400/80 border-blue-500/15",
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
    member?.page_access ?? ["dashboard", "revenue", "cashflow", "collections"]
  );
  const [saving, setSaving] = React.useState(false);
  // Once a user is created, show their credentials instead of the form.
  const [credentials, setCredentials] = React.useState<{ email: string; password: string } | null>(null);

  // Admins implicitly get all pages; viewers/managers use the explicit list.
  const restrictsPages  = role !== "admin";
  const effectiveAccess = role === "admin" ? PAGE_OPTIONS.map((p) => p.value) : pageAccess;

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
          }),
        });
      } else {
        res = await fetch(`/api/users/${member!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, page_access: effectiveAccess }),
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
            <div>
              <Dialog.Title className="text-[14px] font-semibold text-foreground">{title}</Dialog.Title>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70 mt-0.5">
                <Building2 className="w-3 h-3" /> {orgName}
              </p>
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
                          className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] text-muted-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
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
                          className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] text-muted-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
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
                            <Icon className={cn("w-3 h-3", active ? "text-violet-400" : "text-muted-foreground/70")} />
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
                        className="text-[10px] text-violet-400/70 hover:text-violet-400 transition-colors"
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

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({
  member, onEdit, onRevoke,
}: {
  member: OrgMember;
  onEdit: (m: OrgMember) => void;
  onRevoke: (orgId: string, id: string) => void;
}) {
  const [revoking, setRevoking] = React.useState(false);

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
      isPending ? "border-amber-500/15 bg-amber-500/[0.03]" : "border-border bg-accent/40"
    )}>
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
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
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
    </div>
  );
}

// ─── Per-org section ──────────────────────────────────────────────────────────

function OrgSection({
  group, onCreate, onEdit, onRevoke,
}: {
  group: OrgGroup;
  onCreate: (orgId: string, orgName: string) => void;
  onEdit: (m: OrgMember) => void;
  onRevoke: (orgId: string, id: string) => void;
}) {
  const active  = group.members.filter((m) => m.status === "active");
  const pending = group.members.filter((m) => m.status === "pending");

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
          <UserPlus className="w-3 h-3" /> Create User
        </Button>
      </div>

      <div className="p-3 space-y-1.5">
        {group.members.length === 0 ? (
          <p className="text-[12px] text-muted-foreground/70 text-center py-4">
            No members yet — create a user for {group.org.name}
          </p>
        ) : (
          <>
            {active.map((m) => <MemberRow key={m.id} member={m} onEdit={onEdit} onRevoke={onRevoke} />)}
            {pending.map((m) => <MemberRow key={m.id} member={m} onEdit={onEdit} onRevoke={onRevoke} />)}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UsersClient({ groups: initialGroups }: { groups: OrgGroup[] }) {
  const [groups, setGroups] = React.useState<OrgGroup[]>(initialGroups);
  const [creating, setCreating] = React.useState<{ orgId: string; orgName: string } | null>(null);
  const [editing, setEditing] = React.useState<OrgMember | null>(null);

  const orgNameFor = (orgId: string) => groups.find((g) => g.org.id === orgId)?.org.name ?? "";

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
    // Note: the dialog stays open after a create so it can show credentials;
    // it closes itself via onClose. Edit mode closes immediately.
  }

  function handleRevoked(orgId: string, id: string) {
    setGroups((prev) => prev.map((g) =>
      g.org.id === orgId ? { ...g, members: g.members.filter((m) => m.id !== id) } : g
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
            onCreate={(orgId, orgName) => setCreating({ orgId, orgName })}
            onEdit={(m) => setEditing(m)}
            onRevoke={handleRevoked}
          />
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        Creating a user makes a ready-to-use account — share the password shown, and they&apos;ll set their own on first login.
      </p>

      {creating && (
        <MemberDialog
          mode="create"
          orgId={creating.orgId}
          orgName={creating.orgName}
          onClose={() => setCreating(null)}
          onSaved={handleSaved}
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
