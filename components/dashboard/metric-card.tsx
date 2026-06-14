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
        "rounded-xl border border-border bg-card p-3.5 flex flex-col gap-1 transition-all duration-200 hover:border-border/80 hover:-translate-y-px",
        className
      )}
    >
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
            {isUp ? "+" : ""}{trend.toFixed(1)}%{trendLabel ? ` ${trendLabel}` : ""}
          </span>
        )}
      </div>

      {/* Title (sits below the icon chip when one is shown) */}
      {icon && (
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mt-1.5">{title}</span>
      )}

      {/* Value */}
      <div className="num text-[24px] font-bold tracking-tight leading-[1.1] text-foreground">{value}</div>

      {/* Subtitle */}
      {subtitle && <div className="text-[11px] text-muted-foreground leading-snug">{subtitle}</div>}

      {/* Sparkline */}
      {hasSparkline && (
        <div className="mt-2">
          <Sparkline data={sparklineData} color={sparkColor} height={30} strokeWidth={1.5} className="w-full" />
        </div>
      )}
    </div>
  );
}
