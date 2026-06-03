import * as React from "react";
import { cn } from "@/lib/utils";

type RunwaySeverity = "good" | "warning" | "critical";

interface RunwayCardProps {
  days: number;
  formattedValue: string;
  burnRate: number;
  formattedBurn: string;
  cashBalance?: number;
  formattedCash?: string;
  severity: RunwaySeverity;
  className?: string;
}

const severityConfig: Record<RunwaySeverity, { ring: string; glow: string; pill: string; pillText: string; label: string }> = {
  good:    { ring: "#1db884", glow: "rgba(29,184,132,0.25)", pill: "rgba(29,184,132,0.12)", pillText: "#1db884", label: "Healthy — aim for 12+ months before next raise" },
  warning: { ring: "#f59116", glow: "rgba(245,145,22,0.25)",  pill: "rgba(245,145,22,0.12)",  pillText: "#f59116", label: "Getting tight — start extending runway now" },
  critical:{ ring: "#e83a3a", glow: "rgba(232,58,58,0.25)",   pill: "rgba(232,58,58,0.12)",   pillText: "#e83a3a", label: "Critical — immediate action required" },
};

const MAX_DAYS = 365;

// Circumference for r=74: 2π×74 ≈ 464.9
const R = 74;
const CIRC = 2 * Math.PI * R;

export function RunwayCard({
  days,
  formattedBurn,
  cashBalance,
  formattedCash,
  severity,
  className,
}: RunwayCardProps) {
  const cfg = severityConfig[severity];
  const pct = Math.min(days / MAX_DAYS, 1);
  const dash = pct * CIRC;

  const months = Math.floor(days / 30);
  const remDays = days % 30;
  const displayMonths = months > 0 ? `${months}mo${remDays > 0 ? ` ${remDays}d` : ""}` : `${days}d`;

  return (
    <div
      className={cn(
        "relative rounded-xl border border-white/[0.06] p-4 flex flex-col gap-3 overflow-hidden transition-all duration-200 hover:border-white/[0.10] hover:-translate-y-px",
        className
      )}
      style={{ background: "hsl(220 40% 7%)" }}
    >
      {/* Ambient glow behind ring */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{ background: `radial-gradient(ellipse 60% 60% at 85% 50%, ${cfg.glow} 0%, transparent 70%)` }}
      />

      <div className="relative flex items-center gap-5">
        {/* SVG ring */}
        <div className="flex-shrink-0 relative w-[100px] h-[100px]">
          <svg width="100" height="100" viewBox="0 0 180 180" style={{ transform: "rotate(-90deg)" }}>
            {/* track */}
            <circle
              cx="90" cy="90" r={R}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="10"
            />
            {/* progress */}
            <circle
              cx="90" cy="90" r={R}
              fill="none"
              stroke={cfg.ring}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${CIRC}`}
              style={{ filter: `drop-shadow(0 0 6px ${cfg.ring})`, transition: "stroke-dasharray 0.6s ease" }}
            />
          </svg>
          {/* centre label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-white/30">Runway</span>
            <span className="num text-[11px] font-bold text-white/60 mt-0.5">{displayMonths}</span>
          </div>
        </div>

        {/* Big number + meta */}
        <div className="flex flex-col gap-3 flex-1 min-w-0">
          {/* Main value */}
          <div>
            <div
              className="num leading-none font-black tracking-[-0.04em]"
              style={{
                fontSize: "clamp(40px, 5vw, 64px)",
                background: "linear-gradient(180deg, #ffffff 0%, rgba(245,145,22,0.65) 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              {days > 0 ? days : "—"}
              <span style={{ fontSize: "0.45em", opacity: 0.7 }}>d</span>
            </div>
            <p className="text-[10px] text-white/25 mt-0.5">
              Zero cash on{" "}
              {days > 0
                ? new Date(Date.now() + days * 864e5).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </p>
          </div>

          {/* Meta rows */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[9px] font-bold tracking-[0.12em] uppercase text-white/25">Burn</p>
              <p className="num text-[12px] font-semibold text-white/65 mt-0.5">{formattedBurn}<span className="text-white/30">/mo</span></p>
            </div>
            {cashBalance !== undefined && formattedCash && (
              <div>
                <p className="text-[9px] font-bold tracking-[0.12em] uppercase text-white/25">Cash</p>
                <p className="num text-[12px] font-semibold text-white/65 mt-0.5">{formattedCash}</p>
              </div>
            )}
            <div>
              <p className="text-[9px] font-bold tracking-[0.12em] uppercase text-white/25">Net Burn</p>
              <p className="num text-[12px] font-semibold text-white/65 mt-0.5">{formattedBurn}<span className="text-white/30">/mo</span></p>
            </div>
          </div>
        </div>
      </div>

      {/* Health pill */}
      <div
        className="self-start text-[10.5px] font-semibold px-2.5 py-1 rounded-full"
        style={{ background: cfg.pill, color: cfg.pillText }}
      >
        {cfg.label}
      </div>
    </div>
  );
}
