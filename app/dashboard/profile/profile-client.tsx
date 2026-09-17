"use client";

import * as React from "react";
import { toast } from "sonner";
import { Save, RefreshCw, Shield, Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/dashboard/section-card";
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

interface ProfileData {
  user: { id: string; email: string; full_name: string; avatar_url: string | null };
  org: { id: string; name: string; slug: string; currency: string; timezone: string } | null;
  is_owner: boolean;
  can_manage: boolean; // owner OR admin — may edit org details (matches the API gate)
}

const inputCls =
  "w-full px-3 py-2 rounded-lg text-[13px] text-foreground bg-background border border-border placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 disabled:opacity-40 disabled:cursor-not-allowed read-only:bg-muted/40 read-only:text-muted-foreground read-only:cursor-default transition-all";
const labelCls = "text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5";

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
      }));
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4 pb-20">
      <SectionCard title="Your profile" subtitle="How you appear across Finance OS">
        <div className="flex items-center gap-4 py-1">
          <button
            type="button"
            onClick={() => setCropOpen(true)}
            className="relative group flex-shrink-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            title="Change photo"
          >
            <UserAvatar name={fullName} email={data.user.email} src={avatarUrl} size="lg" />
            <span className="absolute inset-0 rounded-2xl bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </span>
          </button>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground truncate">{fullName || data.user.email.split("@")[0]}</p>
            <p className="text-[12px] text-muted-foreground truncate">{data.user.email}</p>
            <div className="flex items-center gap-2 mt-2">
              {data.is_owner ? (
                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5">
                  <Shield className="w-3 h-3" /> Owner
                </span>
              ) : data.can_manage ? (
                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary bg-primary/10 border border-primary/20 rounded px-1.5 py-0.5">Admin</span>
              ) : null}
              <button type="button" onClick={() => setCropOpen(true)} className="text-[11.5px] text-muted-foreground hover:text-foreground underline underline-offset-2">
                Change photo
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3.5">
          <Field label="Display name" value={fullName} onChange={setFullName} hint="Shown in the sidebar and to your team members" />
          <Field label="Email address" value={data.user.email} readOnly hint="Email can't be changed here — contact support" />
        </div>
      </SectionCard>

      {canEditOrg && data.org && (
        <SectionCard title="Company details" subtitle="Organisation-wide settings">
          <div className="space-y-3.5">
            <Field label="Company name" value={orgName} onChange={setOrgName} />
            <Field label="URL slug" value={data.org.slug} readOnly hint="Used in URLs — can't be changed after creation" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField label="Default currency" value={currency} onChange={setCurrency} options={CURRENCIES} />
              <SelectField label="Timezone" value={timezone} onChange={setTimezone} options={TIMEZONES} />
            </div>
          </div>
        </SectionCard>
      )}

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-1 mt-2">
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
