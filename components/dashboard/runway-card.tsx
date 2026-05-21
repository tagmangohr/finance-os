import * as React from "react";
import { Timer } from "lucide-react";
import { cn } from "@/lib/utils";

type RunwaySeverity = "good" | "warning" | "critical";

interface RunwayCardProps {
  days: number;
  formattedValue: string;
  burnRate: number;
  formattedBurn: string;
  severity: RunwaySeverity;
  className?: string;
}

const severityConfig: Record<
  RunwaySeverity,
  { bar: string; glow: string; label: string; icon: string; fill: string }
> = {
  good: {
    bar: "bg-gradient-to-r from-emerald-500 to-emerald-400",
    glow: "shadow-[0_0_30px_hsl(158_64%_48%/0.18)]",
    label: "text-emerald-400",
    icon: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
    fill: "bg-emerald-400",
  },
  warning: {
    bar: "bg-gradient-to-r from-amber-500 to-amber-400",
    glow: "shadow-[0_0_30px_hsl(38_92%_56%/0.18)]",
    label: "text-amber-400",
    icon: "bg-amber-400/10 text-amber-400 border-amber-400/20",
    fill: "bg-amber-400",
  },
  critical: {
    bar: "bg-gradient-to-r from-red-500 to-red-400",
    glow: "shadow-[0_0_30px_hsl(0_72%_56%/0.18)]",
    label: "text-red-400",
    icon: "bg-red-400/10 text-red-400 border-red-400/20",
    fill: "bg-red-400",
  },
};

// Max runway we display on the meter = 365 days (12 months)
const MAX_DAYS = 365;

function getRunwayMonths(days: number): string {
  if (days <= 0) return "Critical — No runway";
  const months = Math.floor(days / 30);
  const remDays = days % 30;
  if (months === 0) return `${days} days`;
  if (remDays === 0) return `${months} month${months !== 1 ? "s" : ""}`;
  return `${months}mo ${remDays}d`;
}

export function RunwayCard({
  days,
  formattedValue,
  burnRate,
  formattedBurn,
  severity,
  className,
}: RunwayCardProps) {
  const config = severityConfig[severity];
  const pct = Math.min((days / MAX_DAYS) * 100, 100);

  const milestones = [
    { label: "3mo", pct: (90 / MAX_DAYS) * 100 },
    { label: "6mo", pct: (180 / MAX_DAYS) * 100 },
    { label: "12mo", pct: (365 / MAX_DAYS) * 100 },
  ];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl bg-card border border-border/60 p-6 transition-all duration-300",
        "before:absolute before:inset-0 before:rounded-2xl before:p-px before:bg-gradient-to-br before:from-white/[0.08] before:to-transparent before:-z-10",
        config.glow,
        className
      )}
    >
      {/* Background texture */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] via-transparent to-transparent pointer-events-none" />

      {/* Header row */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <p className="text-[10px] font-semibold text-white/35 uppercase tracking-[0.12em] mb-1">Runway</p>
          <p
            className={cn(
              "text-[2.4rem] font-bold leading-none tracking-tight",
              config.label
            )}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {getRunwayMonths(days)}
          </p>
          {burnRate > 0 && (
            <p className="text-xs text-white/30 mt-2">
              At <span className="text-white/50 font-medium">{formattedBurn}/mo</span> burn
            </p>
          )}
        </div>
        <div className={cn("w-11 h-11 rounded-xl border flex items-center justify-center flex-shrink-0", config.icon)}>
          <Timer className="w-5 h-5" />
        </div>
      </div>

      {/* Burn meter */}
      <div className="space-y-2">
        <div className="relative h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={cn("absolute left-0 top-0 h-full rounded-full transition-all duration-700", config.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Milestone ticks */}
        <div className="relative h-4">
          {milestones.map(({ label, pct: tickPct }) => (
            <div
              key={label}
              className="absolute flex flex-col items-center"
              style={{ left: `${tickPct}%`, transform: "translateX(-50%)" }}
            >
              <div className="h-1 w-px bg-white/15" />
              <span className="text-[9px] text-white/20 mt-0.5">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Cash remaining if we know it */}
      {days > 0 && (
        <div className="mt-4 pt-4 border-t border-white/[0.05] flex items-center justify-between">
          <span className="text-[11px] text-white/25">Projected zero cash</span>
          <span className="text-[11px] font-semibold text-white/50">
            {new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString("en-IN", {
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      )}
    </div>
  );
}
