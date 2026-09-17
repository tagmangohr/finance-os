"use client";

import * as React from "react";
import { toast } from "sonner";
import { Save, RefreshCw, Shield, Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/ui/user-avatar";
import { AvatarCropper } from "@/components/dashboard/avatar-cropper";

const CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee (₹)" },
  { value: "USD", label: "USD — US Dollar ($)" },
  { value: "EUR", label: "EUR — Euro (€)" },
  { value: "GBP", label: "GBP — British Pound (£)" },
  { value: "SGD", label: "SGD — Singapore Dollar (S$)" },
  { value: "AED", label: "AED — UAE Dirham (د.إ)" },
];

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "IST — India (UTC+5:30)" },
  { value: "UTC", label: "UTC — Coordinated Universal Time" },
  { value: "America/New_York", label: "EST/EDT — US Eastern" },
  { value: "America/Chicago", label: "CST/CDT — US Central" },
  { value: "America/Los_Angeles", label: "PST/PDT — US Pacific" },
  { value: "Europe/London", label: "GMT/BST — UK London" },
  { value: "Europe/Paris", label: "CET/CEST — Central Europe" },
  { value: "Asia/Dubai", label: "GST — Gulf Standard (UTC+4)" },
  { value: "Asia/Singapore", label: "SGT — Singapore (UTC+8)" },
  { value: "Asia/Tokyo", label: "JST — Japan (UTC+9)" },
  { value: "Australia/Sydney", label: "AEST/AEDT — Sydney" },
];

type OrgRole = "owner" | "admin" | "manager" | "viewer";
const ROLE_LABEL: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", manager: "Manager", viewer: "Viewer" };

interface ProfileData {
  user: { id: string; email: string; full_name: string; avatar_url: string | null; member_since: string | null };
  org: { id: string; name: string; slug: string; currency: string; timezone: string } | null;
  is_owner: boolean;
  can_manage: boolean; // owner OR admin — may edit org details (matches the API gate)
  active_org_id: string;
  orgs: { id: string; name: string; role: OrgRole }[];
}

const inputCls =
  "w-full px-3 py-2 rounded-lg text-[13px] text-foreground bg-background border border-border placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed read-only:bg-muted/40 read-only:text-muted-foreground read-only:cursor-default transition-all";
const labelCls = "text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5";
const microCls = "text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground";

function Field({ label, value, onChange, readOnly, hint }: {
  label: string; value: string; onChange?: (v: string) => void; readOnly?: boolean; hint?: string;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input value={value} onChange={(e) => onChange?.(e.target.value)} readOnly={readOnly} className={inputCls} spellCheck={false} />
      {hint && <p className="text-[10.5px] text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls + " appearance-none"}>
        {options.map((o) => <option key={o.value} value={o.value} className="bg-popover">{o.label}</option>)}
      </select>
    </div>
  );
}

/** Role pill — primary tint for owner/admin, muted for manager/viewer. */
function RolePill({ role }: { role: OrgRole }) {
  const strong = role === "owner" || role === "admin";
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 border ${
      strong ? "text-primary bg-primary/10 border-primary/20" : "text-muted-foreground bg-muted border-border"
    }`}>
      {role === "owner" && <Shield className="w-2.5 h-2.5" />}
      {ROLE_LABEL[role]}
    </span>
  );
}

function fmtMonth(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export function ProfileClient({ initial }: { initial: ProfileData }) {
  const [data, setData] = React.useState<ProfileData>(initial);
  const [fullName, setFullName] = React.useState(initial.user.full_name);
  const [avatarUrl, setAvatarUrl] = React.useState<string | null>(initial.user.avatar_url);
  const [orgName, setOrgName] = React.useState(initial.org?.name ?? "");
  const [currency, setCurrency] = React.useState(initial.org?.currency ?? "INR");
  const [timezone, setTimezone] = React.useState(initial.org?.timezone ?? "Asia/Kolkata");
  const [saving, setSaving] = React.useState(false);
  const [cropOpen, setCropOpen] = React.useState(false);

  const canEditOrg = data.can_manage && !!data.org;
  const activeRole: OrgRole = data.orgs.find((o) => o.id === data.active_org_id)?.role
    ?? (data.is_owner ? "owner" : data.can_manage ? "admin" : "viewer");
  const displayName = fullName || data.user.email.split("@")[0];

  const hasUserChanges = fullName !== data.user.full_name;
  const hasOrgChanges = canEditOrg && (
    orgName !== (data.org?.name ?? "") ||
    currency !== (data.org?.currency ?? "INR") ||
    timezone !== (data.org?.timezone ?? "Asia/Kolkata")
  );
  const dirty = hasUserChanges || hasOrgChanges;

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (hasUserChanges) body.full_name = fullName;
      if (canEditOrg) {
        if (orgName !== data.org?.name) body.org_name = orgName;
        if (currency !== data.org?.currency) body.currency = currency;
        if (timezone !== data.org?.timezone) body.timezone = timezone;
      }
      const res = await fetch("/api/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");
      setData((prev) => ({
        ...prev,
        user: { ...prev.user, full_name: fullName },
        org: prev.org ? { ...prev.org, name: orgName, currency, timezone } : null,
        orgs: prev.orgs.map((o) => (o.id === prev.active_org_id ? { ...o, name: orgName } : o)),
      }));
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      {/* ── Identity header ─────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="h-20 bg-gradient-to-r from-primary/90 via-primary/70 to-sky-500/60" />
        <div className="px-5 pb-4 -mt-9 flex items-end gap-4 flex-wrap">
          <button
            type="button"
            onClick={() => setCropOpen(true)}
            className="relative group flex-shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            title="Change photo"
          >
            <UserAvatar name={fullName} email={data.user.email} src={avatarUrl} size="xl" rounded="full" className="ring-4 ring-card shadow-md" />
            <span className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </span>
          </button>
          <div className="min-w-0 flex-1 pb-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[17px] font-bold text-foreground truncate">{displayName}</p>
              <RolePill role={activeRole} />
            </div>
            <p className="text-[12.5px] text-muted-foreground truncate mt-0.5">{data.user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => setCropOpen(true)}
            className="mb-1 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-card text-[12px] font-semibold text-foreground hover:bg-muted transition-colors"
          >
            <Camera className="w-3.5 h-3.5" /> Change photo
          </button>
        </div>
      </div>

      {/* ── Two-column body ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4 items-start">
        {/* Left rail — at a glance */}
        <div className="rounded-xl border border-border bg-card p-4">
          <p className={microCls}>At a glance</p>
          <div className="mt-3 space-y-3.5">
            <div>
              <p className="text-[11px] text-muted-foreground">Member since</p>
              <p className="text-[13px] font-semibold text-foreground mt-0.5">{fmtMonth(data.user.member_since)}</p>
            </div>
            <div className="h-px bg-border" />
            <div>
              <p className="text-[11px] text-muted-foreground">Your role</p>
              <p className="text-[13px] font-semibold text-foreground mt-0.5">
                {ROLE_LABEL[activeRole]}{data.org ? ` · ${data.org.name}` : ""}
              </p>
            </div>
            <div className="h-px bg-border" />
            <div>
              <p className="text-[11px] text-muted-foreground mb-2">
                Organisation{data.orgs.length === 1 ? "" : "s"} · {data.orgs.length}
              </p>
              <div className="space-y-2">
                {data.orgs.map((o) => (
                  <div key={o.id} className="flex items-center gap-2">
                    <UserAvatar name={o.name} size="xs" rounded="lg" />
                    <span className="text-[12px] font-medium text-foreground flex-1 min-w-0 truncate">{o.name}</span>
                    <RolePill role={o.role} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right — editable details */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <p className={microCls}>Your details</p>
            <div className="mt-3.5 space-y-3.5">
              <Field label="Display name" value={fullName} onChange={setFullName} hint="Shown in the sidebar and to your team members" />
              <Field label="Email address" value={data.user.email} readOnly hint="Email can't be changed here — contact support" />
            </div>
          </div>

          {canEditOrg && data.org && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className={microCls}>Company details</p>
              <div className="mt-3.5 space-y-3.5">
                <Field label="Company name" value={orgName} onChange={setOrgName} />
                <Field label="URL slug" value={data.org.slug} readOnly hint="Used in URLs — can't be changed after creation" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SelectField label="Default currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
                  <SelectField label="Timezone" value={timezone} onChange={setTimezone} options={TIMEZONES} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Sticky save bar ─────────────────────────────────────────── */}
      <div className="sticky bottom-3 z-10">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 backdrop-blur px-4 py-2.5 shadow-sm">
          <p className="text-[11.5px] text-muted-foreground flex items-center gap-1.5">
            {dirty
              ? <><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Unsaved changes</>
              : <><Check className="w-3.5 h-3.5 text-emerald-600" /> All changes saved</>}
          </p>
          <Button disabled={!dirty || saving} onClick={handleSave} className="gap-2">
            {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save changes</>}
          </Button>
        </div>
      </div>

      {cropOpen && (
        <AvatarCropper
          userId={data.user.id}
          onClose={() => setCropOpen(false)}
          onUploaded={(url) => { setAvatarUrl(url); toast.success("Photo updated"); }}
        />
      )}
    </div>
  );
}
