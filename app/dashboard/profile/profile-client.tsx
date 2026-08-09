"use client";

import * as React from "react";
import { toast } from "sonner";
import { User, Building2, Save, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Constants ────────────────────────────────────────────────────────────────

const CURRENCIES = [
  { value: "INR", label: "INR — Indian Rupee (₹)" },
  { value: "USD", label: "USD — US Dollar ($)" },
  { value: "EUR", label: "EUR — Euro (€)" },
  { value: "GBP", label: "GBP — British Pound (£)" },
  { value: "SGD", label: "SGD — Singapore Dollar (S$)" },
  { value: "AED", label: "AED — UAE Dirham (د.إ)" },
];

const TIMEZONES = [
  { value: "Asia/Kolkata",     label: "IST — India (UTC+5:30)" },
  { value: "UTC",              label: "UTC — Coordinated Universal Time" },
  { value: "America/New_York", label: "EST/EDT — US Eastern" },
  { value: "America/Chicago",  label: "CST/CDT — US Central" },
  { value: "America/Los_Angeles", label: "PST/PDT — US Pacific" },
  { value: "Europe/London",    label: "GMT/BST — UK London" },
  { value: "Europe/Paris",     label: "CET/CEST — Central Europe" },
  { value: "Asia/Dubai",       label: "GST — Gulf Standard (UTC+4)" },
  { value: "Asia/Singapore",   label: "SGT — Singapore (UTC+8)" },
  { value: "Asia/Tokyo",       label: "JST — Japan (UTC+9)" },
  { value: "Australia/Sydney", label: "AEST/AEDT — Sydney" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  user: { id: string; email: string; full_name: string };
  org: { id: string; name: string; slug: string; currency: string; timezone: string } | null;
  is_owner: boolean;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function initials(name: string, email: string): string {
  const n = name.trim();
  if (n) {
    const parts = n.split(" ");
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : n.slice(0, 2).toUpperCase();
  }
  return email.charAt(0).toUpperCase();
}

function Field({
  label, value, onChange, type = "text", disabled = false, readOnly = false,
  hint, children,
}: {
  label: string; value?: string; onChange?: (v: string) => void;
  type?: string; disabled?: boolean; readOnly?: boolean;
  hint?: string; children?: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
        {label}
      </label>
      {children ?? (
        <input
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
          disabled={disabled}
          readOnly={readOnly}
          className="w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-40 disabled:cursor-not-allowed read-only:opacity-50 read-only:cursor-default transition-all"
          style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
        />
      )}
      {hint && <p className="text-[10.5px] text-muted-foreground/70 mt-1">{hint}</p>}
    </div>
  );
}

function SelectField({
  label, value, onChange, options, disabled,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 rounded-lg text-[13px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-40 disabled:cursor-not-allowed appearance-none"
        style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} className="bg-popover">{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function Card({ icon: Icon, title, children }: {
  icon: React.ElementType; title: string; children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl p-5 space-y-4"
      style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--border))" }}
    >
      <div className="flex items-center gap-2.5 mb-1">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(124,82,240,0.12)", border: "1px solid rgba(124,82,240,0.20)" }}
        >
          <Icon className="w-3.5 h-3.5 text-primary" />
        </div>
        <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProfileClient({ initial }: { initial: ProfileData }) {
  const [data, setData] = React.useState<ProfileData>(initial);

  // User fields
  const [fullName, setFullName] = React.useState(initial.user.full_name);

  // Org fields
  const [orgName,  setOrgName]  = React.useState(initial.org?.name     ?? "");
  const [currency, setCurrency] = React.useState(initial.org?.currency ?? "INR");
  const [timezone, setTimezone] = React.useState(initial.org?.timezone ?? "Asia/Kolkata");

  const [saving, setSaving] = React.useState(false);

  const hasUserChanges = fullName !== data.user.full_name;
  const hasOrgChanges  = data.is_owner && (
    orgName  !== (data.org?.name     ?? "") ||
    currency !== (data.org?.currency ?? "INR") ||
    timezone !== (data.org?.timezone ?? "Asia/Kolkata")
  );
  const dirty = hasUserChanges || hasOrgChanges;

  const handleSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      if (hasUserChanges) body.full_name = fullName;
      if (data.is_owner) {
        if (orgName  !== data.org?.name)     body.org_name = orgName;
        if (currency !== data.org?.currency) body.currency  = currency;
        if (timezone !== data.org?.timezone) body.timezone  = timezone;
      }

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save");

      // Reflect saved state
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

  const avatarLetters = initials(fullName || data.user.full_name, data.user.email);

  return (
    <div className="max-w-2xl space-y-5">

      {/* User Profile card */}
      <Card icon={User} title="Your Profile">
        {/* Avatar row */}
        <div className="flex items-center gap-4 pb-1">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-[22px] font-bold text-white flex-shrink-0 select-none"
            style={{
              background: "linear-gradient(135deg, rgba(124,82,240,0.5), rgba(124,82,240,0.2))",
              border: "1px solid rgba(124,82,240,0.3)",
              boxShadow: "0 0 20px rgba(124,82,240,0.2)",
            }}
          >
            {avatarLetters}
          </div>
          <div>
            <p className="text-[14px] font-semibold text-foreground">
              {fullName || data.user.email.split("@")[0]}
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">{data.user.email}</p>
            {data.is_owner && (
              <div className="flex items-center gap-1 mt-1.5">
                <Shield className="w-3 h-3 text-primary" />
                <span className="text-[10.5px] text-primary/70 font-medium">Organisation Owner</span>
              </div>
            )}
          </div>
        </div>

        <Field
          label="Display Name"
          value={fullName}
          onChange={setFullName}
          hint="Shown in the sidebar and to your team members"
        />

        <Field
          label="Email Address"
          value={data.user.email}
          readOnly
          hint="Email cannot be changed here — contact support"
        />
      </Card>

      {/* Company / Org card — owner only */}
      {data.is_owner && data.org && (
        <Card icon={Building2} title="Company Details">
          <Field
            label="Company Name"
            value={orgName}
            onChange={setOrgName}
          />

          <Field
            label="URL Slug"
            value={data.org.slug}
            readOnly
            hint="Used in URLs — cannot be changed after creation"
          />

          <div className="grid grid-cols-2 gap-3">
            <SelectField
              label="Default Currency"
              value={currency}
              onChange={setCurrency}
              options={CURRENCIES}
            />
            <SelectField
              label="Timezone"
              value={timezone}
              onChange={setTimezone}
              options={TIMEZONES}
            />
          </div>
        </Card>
      )}

      {/* Save bar */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-[11px] text-muted-foreground/70">
          {dirty ? "You have unsaved changes" : "All changes saved"}
        </p>
        <Button
          disabled={!dirty || saving}
          onClick={handleSave}
          className="gap-2"
        >
          {saving
            ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</>
            : <><Save className="w-3.5 h-3.5" /> Save Changes</>
          }
        </Button>
      </div>
    </div>
  );
}
