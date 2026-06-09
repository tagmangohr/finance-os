"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  UserPlus, X, RefreshCw, Shield, Eye, Mail, Trash2, Settings2, Check,
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
  { value: "data",         label: "Raw Data" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrgMember {
  id:            string;
  invited_email: string;
  user_id:       string | null;
  full_name:     string | null;
  role:          "admin" | "viewer";
  page_access:   string[];
  status:        "pending" | "active" | "revoked";
  created_at:    string;
}

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

function RoleBadge({ role }: { role: "admin" | "viewer" }) {
  return role === "admin"
    ? (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-500/[0.12] text-violet-400 border border-violet-500/20">
        <Shield className="w-2.5 h-2.5" /> Admin
      </span>
    )
    : (
      <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/[0.10] text-blue-400/80 border border-blue-500/15">
        <Eye className="w-2.5 h-2.5" /> Viewer
      </span>
    );
}

function PageChip({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={cn(
        "text-[9.5px] font-medium px-1.5 py-0.5 rounded",
        active
          ? "bg-emerald-500/[0.12] text-emerald-400/80"
          : "bg-white/[0.04] text-white/20 line-through"
      )}
    >
      {label}
    </span>
  );
}

// ─── Invite / Edit dialog ─────────────────────────────────────────────────────

interface MemberDialogProps {
  mode: "invite" | "edit";
  member?: OrgMember;
  onClose: () => void;
  onSaved: (member: OrgMember) => void;
}

function MemberDialog({ mode, member, onClose, onSaved }: MemberDialogProps) {
  const [email,       setEmail]       = React.useState(member?.invited_email ?? "");
  const [role,        setRole]        = React.useState<"admin" | "viewer">(member?.role ?? "viewer");
  const [pageAccess,  setPageAccess]  = React.useState<string[]>(
    member?.page_access ?? ["dashboard", "revenue", "cashflow", "collections"]
  );
  const [saving, setSaving] = React.useState(false);

  // When role = admin, force all pages selected (visual only — the server ignores page_access for admins)
  const effectiveAccess = role === "admin"
    ? PAGE_OPTIONS.map((p) => p.value)
    : pageAccess;

  function togglePage(value: string) {
    if (role === "admin") return;
    setPageAccess((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  }

  function toggleAll() {
    if (role === "admin") return;
    setPageAccess((prev) =>
      prev.length === PAGE_OPTIONS.length ? [] : PAGE_OPTIONS.map((p) => p.value)
    );
  }

  const handleSave = async () => {
    if (mode === "invite" && (!email.trim() || !email.includes("@"))) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(true);
    try {
      let res: Response;
      if (mode === "invite") {
        res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), role, page_access: effectiveAccess }),
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
      toast.success(mode === "invite" ? "Invite sent" : "Permissions updated");
      onSaved(data as OrgMember);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed z-[201] w-[calc(100vw-32px)] max-w-[460px] bg-[#0c1221] border border-white/[0.08] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.75)] focus:outline-none"
          style={{ top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.05]">
            <Dialog.Title className="text-[14px] font-semibold text-white/85">
              {mode === "invite" ? "Invite Team Member" : "Edit Permissions"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1.5 rounded-lg text-white/25 hover:text-white/60 hover:bg-white/[0.05] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Email (invite only) */}
            {mode === "invite" && (
              <div>
                <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-white/30 block mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/20" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                    placeholder="colleague@company.com"
                    autoFocus
                    className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] text-white/75 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                  />
                </div>
              </div>
            )}

            {/* Role */}
            <div>
              <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-white/30 block mb-1.5">
                Role
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(["admin", "viewer"] as const).map((r) => {
                  const active = role === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className="flex flex-col items-start px-3 py-2.5 rounded-xl transition-all text-left"
                      style={{
                        background: active ? "rgba(124,82,240,0.10)" : "rgba(255,255,255,0.025)",
                        border: `1px solid ${active ? "rgba(124,82,240,0.30)" : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {r === "admin"
                          ? <Shield className={cn("w-3 h-3", active ? "text-violet-400" : "text-white/25")} />
                          : <Eye    className={cn("w-3 h-3", active ? "text-violet-400" : "text-white/25")} />
                        }
                        <span className={cn("text-[12px] font-semibold capitalize", active ? "text-white/85" : "text-white/40")}>
                          {r}
                        </span>
                      </div>
                      <span className="text-[10px] text-white/25">
                        {r === "admin" ? "Full access + manage team" : "Read-only, selected pages"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Page access */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-white/30">
                  Page Access
                </label>
                {role === "viewer" && (
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
                      disabled={role === "admin"}
                      className={cn(
                        "flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-all",
                        "disabled:cursor-default",
                        on
                          ? "bg-emerald-500/[0.08] border border-emerald-500/20"
                          : "bg-white/[0.025] border border-white/[0.05] hover:bg-white/[0.04]",
                        role === "admin" && "opacity-60"
                      )}
                    >
                      <div className={cn(
                        "w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border",
                        on ? "bg-emerald-500/20 border-emerald-500/40" : "border-white/[0.12]"
                      )}>
                        {on && <Check className="w-2 h-2 text-emerald-400" />}
                      </div>
                      <span className={cn(
                        "text-[11.5px] font-medium",
                        on ? "text-white/75" : "text-white/30"
                      )}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {role === "admin" && (
                <p className="text-[10.5px] text-white/25 mt-1.5">Admins always have access to all pages.</p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2.5 px-5 pb-5 pt-2">
            <Dialog.Close asChild>
              <Button variant="outline" className="flex-1 border-white/[0.07] bg-transparent text-white/40 hover:text-white/70 hover:bg-white/[0.04] hover:border-white/[0.12]">
                Cancel
              </Button>
            </Dialog.Close>
            <Button className="flex-1 gap-2" onClick={handleSave} disabled={saving}>
              {saving
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                : mode === "invite" ? "Send Invite" : "Save Changes"
              }
            </Button>
          </div>
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
  onRevoke: (id: string) => void;
}) {
  const [revoking, setRevoking] = React.useState(false);

  const doRevoke = async () => {
    if (!confirm(`Remove ${member.invited_email} from your team?`)) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/users/${member.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }
      toast.success("Access revoked");
      onRevoke(member.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setRevoking(false);
    }
  };

  const isPending = member.status === "pending";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all",
        isPending
          ? "border-amber-500/15 bg-amber-500/[0.03]"
          : "border-white/[0.06] bg-white/[0.02]"
      )}
    >
      {/* Avatar */}
      <Avatar name={member.full_name} email={member.invited_email} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12.5px] font-medium text-white/75 truncate">
            {member.full_name || member.invited_email.split("@")[0]}
          </p>
          <RoleBadge role={member.role} />
          {isPending && (
            <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/[0.12] text-amber-400/80 border border-amber-500/20">
              Pending
            </span>
          )}
        </div>
        <p className="text-[10.5px] text-white/30 mt-0.5 truncate">{member.invited_email}</p>

        {/* Page chips (viewer only — admin sees "All pages") */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {member.role === "admin"
            ? <span className="text-[9.5px] text-white/25 font-medium">All pages</span>
            : PAGE_OPTIONS.map(({ value, label }) => (
                <PageChip key={value} label={label} active={member.page_access.includes(value)} />
              ))
          }
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={() => onEdit(member)}
          title="Edit permissions"
          className="p-1.5 rounded-lg text-white/20 hover:text-white/60 hover:bg-white/[0.06] transition-all"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={doRevoke}
          disabled={revoking}
          title="Revoke access"
          className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/[0.08] transition-all"
        >
          {revoking
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : <Trash2 className="w-3.5 h-3.5" />
          }
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function UsersClient({ initialMembers }: { initialMembers: OrgMember[] }) {
  const [members, setMembers]   = React.useState<OrgMember[]>(initialMembers);
  const [inviting, setInviting] = React.useState(false);
  const [editing,  setEditing]  = React.useState<OrgMember | null>(null);

  const active  = members.filter((m) => m.status === "active");
  const pending = members.filter((m) => m.status === "pending");

  function handleSaved(updated: OrgMember) {
    setMembers((prev) => {
      const idx = prev.findIndex((m) => m.id === updated.id);
      return idx >= 0
        ? prev.map((m) => (m.id === updated.id ? updated : m))
        : [...prev, updated];
    });
    setInviting(false);
    setEditing(null);
  }

  function handleRevoked(id: string) {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <>
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-bold text-white/85 tracking-tight">Team</h1>
          <p className="text-[12px] text-white/35 mt-0.5">Invite teammates and control their page access</p>
        </div>
        <Button className="gap-2" onClick={() => setInviting(true)}>
          <UserPlus className="w-3.5 h-3.5" />
          Invite Member
        </Button>
      </div>

      {/* Active members */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-white/25">
            Active Members
          </span>
          <span className="text-[10px] text-white/20 font-mono">{active.length}</span>
        </div>
        <div className="p-3 space-y-1.5">
          {active.length === 0
            ? (
              <p className="text-[12px] text-white/25 text-center py-4">
                No active members yet — invite someone below
              </p>
            )
            : active.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  onEdit={(mem) => setEditing(mem)}
                  onRevoke={handleRevoked}
                />
              ))
          }
        </div>
      </div>

      {/* Pending invites */}
      {pending.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(245,145,22,0.15)" }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ background: "rgba(245,145,22,0.04)", borderBottom: "1px solid rgba(245,145,22,0.10)" }}
          >
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-amber-400/50">
              Pending Invites
            </span>
            <span className="text-[10px] text-amber-400/30 font-mono">{pending.length}</span>
          </div>
          <div className="p-3 space-y-1.5">
            {pending.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                onEdit={(mem) => setEditing(mem)}
                onRevoke={handleRevoked}
              />
            ))}
          </div>
          <div
            className="px-4 py-2.5"
            style={{ background: "rgba(245,145,22,0.03)", borderTop: "1px solid rgba(245,145,22,0.08)" }}
          >
            <p className="text-[11px] text-amber-400/50">
              Pending invites activate automatically when the invitee signs in with that email address.
            </p>
          </div>
        </div>
      )}

      {/* Invite dialog */}
      {inviting && (
        <MemberDialog
          mode="invite"
          onClose={() => setInviting(false)}
          onSaved={handleSaved}
        />
      )}

      {/* Edit dialog */}
      {editing && (
        <MemberDialog
          mode="edit"
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
