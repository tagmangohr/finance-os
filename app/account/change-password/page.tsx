"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { KeyRound, Loader2, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ChangePasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      // Set the new password AND clear the must_change_password flag in one call.
      const { error } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (error) throw error;
      toast.success("Password updated");
      // Full reload so the dashboard layout re-reads the (now-cleared) flag.
      window.location.href = "/dashboard";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px]">
        <div className="flex items-center gap-2 justify-center mb-6">
          <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <span className="text-[15px] font-bold text-foreground">Finance OS</span>
        </div>

        <div className="rounded-2xl border border-border bg-popover p-6 shadow-[0_25px_60px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-4 h-4 text-primary" />
            <h1 className="text-[15px] font-semibold text-foreground">Set your password</h1>
          </div>
          <p className="text-[12px] text-muted-foreground/70 mb-5 leading-relaxed">
            Welcome! For security, please choose your own password before continuing.
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoFocus
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg text-[13px] text-foreground placeholder:text-muted-foreground/70 bg-accent border border-border focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 block mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                className="w-full px-3 py-2 rounded-lg text-[13px] text-foreground placeholder:text-muted-foreground/70 bg-accent border border-border focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <Button type="submit" className="w-full gap-2" disabled={loading}>
              {loading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : "Save & continue"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
