"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { toast } from "sonner";
import { TrendingUp, Loader2 } from "lucide-react";
import { signInAction } from "./actions";

/**
 * Login only — Finance OS is invite-only. Accounts are created exclusively by an
 * admin via Team → Create User (server-side admin.createUser); there is no public
 * self-signup. (Also disable "Allow new users to sign up" in Supabase Auth settings
 * for the hard server-side lock — this page removes the client path.)
 */
export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      // Server Action: calls signInWithPassword server-side so the session is
      // written via Set-Cookie headers before window.location.href fires.
      const result = await signInAction(email, password);
      if (result.error) throw new Error(result.error);
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      toast.error(message);
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
          <h1 className="text-2xl font-semibold mb-1">Welcome back</h1>
          <p className="text-muted-foreground text-sm mb-6">Sign in to your Finance OS</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground mt-5">
            Access is invite-only. Ask your admin to create your account.
          </p>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-4">
          The intelligence layer for founders &amp; MSMEs
        </p>
      </div>
    </div>
  );
}
