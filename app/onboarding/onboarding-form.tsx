"use client";

import { useState } from "react";
import { toast } from "sonner";
import { TrendingUp, ArrowRight, Loader2, Building2, Globe } from "lucide-react";
import { createOrgAction } from "./actions";
import { CURRENCIES, TIMEZONES } from "@/lib/org/org-options";

export function OnboardingForm() {
  const [orgName, setOrgName]   = useState("");
  const [currency, setCurrency] = useState("INR");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) return;
    setLoading(true);

    try {
      // Server action creates the org and sets the active-org cookie. On success
      // we do a FULL reload into /dashboard (not router.push) so the new cookie
      // is in play on the next server render — the auth-context lesson.
      const result = await createOrgAction({
        name:     orgName.trim(),
        currency,
        timezone,
      });

      if (result?.error) {
        toast.error(result.error);
        setLoading(false);
        return;
      }

      window.location.href = "/dashboard";
    } catch {
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="text-xl font-bold">Finance OS</span>
        </div>

        <div className="bg-card border border-border rounded-xl p-8 shadow-sm">
          <h1 className="text-2xl font-semibold mb-1">Set up your organisation</h1>
          <p className="text-muted-foreground text-sm mb-6">
            This takes 30 seconds. You can change everything later.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
                <Building2 className="w-3.5 h-3.5" />
                Organisation / Business name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Acme Inc."
                required
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">Primary currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-sm font-medium mb-1.5">
                <Globe className="w-3.5 h-3.5" />
                Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={loading || !orgName.trim()}
              className="w-full h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Continue to dashboard <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
