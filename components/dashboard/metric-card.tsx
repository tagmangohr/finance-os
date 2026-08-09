import * as React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";

type Severity = "good" | "warning" | "critical" | "neutral";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  trendLabel?: string;
  /** Lucide icon element, shown in a colored chip when provided. */
  icon?: React.ReactNode;
  severity?: Severity;
  sparklineData?: number[];
  /** Per-metric identity color, e.g. "hsl(var(--metric-cash))". Drives the chip + sparkline. */
  accentColor?: string;
  sparklineColor?: string;
  className?: string;
}

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  icon,
  sparklineData,
  accentColor = "hsl(var(--primary))",
  sparklineColor,
  className,
}: MetricCardProps) {
  const hasTrend = trend !== undefined;
  const isUp = hasTrend && trend >= 0;
  const sparkColor = sparklineColor ?? accentColor;
  const hasSparkline = sparklineData && sparklineData.length >= 2;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card pl-4 pr-3.5 py-3.5 flex flex-col gap-1 transition-all duration-200 hover:border-border/80 hover:-translate-y-px hover:shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)]",
        className
      )}
    >
      {/* Accent stripe — carries this metric's identity colour down the left edge */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: accentColor, opacity: 0.9 }}
      />
      {/* Icon chip + delta */}
      <div className="flex items-center justify-between">
        {icon ? (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `color-mix(in srgb, ${accentColor} 14%, transparent)`, color: accentColor }}
          >
            {icon}
          </span>
        ) : (
          <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">{title}</span>
        )}
        {hasTrend && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded",
              isUp ? "text-success bg-success/10" : "text-destructive bg-destructive/10"
            )}
          >
            {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
            {Math.abs(trend).toFixed(1)}%{trendLabel ? ` ${trendLabel}` : ""}
          </span>
        )}
      </div>

      {/* Title (sits below the icon chip when one is shown) */}
      {icon && (
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mt-1.5">{title}</span>
      )}

      {/* Value */}
      <div className="num text-[27px] font-bold tracking-[-0.02em] leading-[1.05] text-foreground">{value}</div>

      {/* Subtitle */}
      {subtitle && <div className="text-[11px] text-muted-foreground leading-snug">{subtitle}</div>}

      {/* Sparkline — always reserve the slot so every card is the same height.
          A faint baseline stands in when a metric has no series (keeps the grid
          tidy instead of leaving dead space under short cards). */}
      <div className="mt-auto pt-2">
        {hasSparkline ? (
          <Sparkline data={sparklineData} color={sparkColor} height={30} strokeWidth={1.5} className="w-full" />
        ) : (
          <div className="h-[30px] flex items-center" aria-hidden="true">
            <span className="w-full border-t border-dashed border-border/70" />
          </div>
        )}
      </div>
    </div>
  );
}
