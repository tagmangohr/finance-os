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
        "group relative overflow-hidden rounded-xl border border-border bg-card pl-3.5 pr-3 py-3 flex flex-col gap-1.5 transition-all duration-200 hover:border-border/80 hover:-translate-y-px hover:shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)]",
        className
      )}
    >
      {/* Accent stripe — carries this metric's identity colour down the left edge */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: accentColor, opacity: 0.9 }}
      />

      {/* Header row: (icon +) title on the left, trend delta on the right. Title
          ALWAYS sits here — icon or not — so the value baseline is identical across
          every card in a row (no more icon/no-icon misalignment). */}
      <div className="flex items-center justify-between gap-2 min-h-[24px]">
        <div className="flex items-center gap-1.5 min-w-0">
          {icon && (
            <span
              className="w-6 h-6 shrink-0 rounded-md flex items-center justify-center [&_svg]:size-3.5"
              style={{ background: `color-mix(in srgb, ${accentColor} 14%, transparent)`, color: accentColor }}
            >
              {icon}
            </span>
          )}
          <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-muted-foreground truncate">{title}</span>
        </div>
        {hasTrend && (
          <span
            className={cn(
              "shrink-0 inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded",
              isUp ? "text-success bg-success/10" : "text-destructive bg-destructive/10"
            )}
          >
            {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
            {Math.abs(trend).toFixed(1)}%{trendLabel ? ` ${trendLabel}` : ""}
          </span>
        )}
      </div>

      {/* Value */}
      <div className="num text-[22px] font-bold tracking-[-0.02em] leading-[1.1] text-foreground">{value}</div>

      {/* Subtitle */}
      {subtitle && <div className="text-[11px] text-muted-foreground leading-snug">{subtitle}</div>}

      {/* Sparkline — only when there's a series to show; no dead placeholder slot
          (that empty reserved space was what made every card look oversized). */}
      {hasSparkline && (
        <div className="mt-auto pt-1.5">
          <Sparkline data={sparklineData} color={sparkColor} height={28} strokeWidth={1.5} className="w-full" />
        </div>
      )}
    </div>
  );
}
