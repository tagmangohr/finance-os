import * as React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Sparkline } from "@/components/ui/sparkline";

type Severity = "good" | "warning" | "critical" | "neutral";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  severity?: Severity;
  sparklineData?: number[];
  sparklineColor?: string;
  className?: string;
}

const severityConfig: Record<Severity, {
  bar: string;
  glow: string;
  iconBg: string;
  iconText: string;
  trendUp: string;
  trendDown: string;
}> = {
  good: {
    bar: "bg-emerald-400",
    glow: "hover:shadow-[0_0_24px_hsl(158_64%_48%/0.2)]",
    iconBg: "bg-emerald-400/10 border-emerald-400/20",
    iconText: "text-emerald-400",
    trendUp: "text-emerald-400",
    trendDown: "text-red-400",
  },
  warning: {
    bar: "bg-amber-400",
    glow: "hover:shadow-[0_0_24px_hsl(38_92%_56%/0.2)]",
    iconBg: "bg-amber-400/10 border-amber-400/20",
    iconText: "text-amber-400",
    trendUp: "text-emerald-400",
    trendDown: "text-amber-400",
  },
  critical: {
    bar: "bg-red-400",
    glow: "hover:shadow-[0_0_24px_hsl(0_72%_56%/0.2)]",
    iconBg: "bg-red-400/10 border-red-400/20",
    iconText: "text-red-400",
    trendUp: "text-emerald-400",
    trendDown: "text-red-400",
  },
  neutral: {
    bar: "bg-primary/40",
    glow: "hover:shadow-[0_0_24px_hsl(258_88%_66%/0.15)]",
    iconBg: "bg-primary/10 border-primary/20",
    iconText: "text-primary",
    trendUp: "text-emerald-400",
    trendDown: "text-red-400",
  },
};

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  icon,
  severity = "neutral",
  sparklineData,
  sparklineColor,
  className,
}: MetricCardProps) {
  const isPositiveTrend = trend !== undefined && trend >= 0;
  const hasTrend = trend !== undefined;
  const config = severityConfig[severity];
  const hasSparkline = sparklineData && sparklineData.length >= 2;

  // Default sparkline color based on trend direction or severity
  const resolvedSparkColor =
    sparklineColor ??
    (hasTrend
      ? isPositiveTrend
        ? "hsl(158, 64%, 48%)"
        : "hsl(0, 72%, 56%)"
      : "hsl(258, 88%, 66%)");

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-card border border-border/60 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-border",
        config.glow,
        className
      )}
    >
      {/* Left severity bar */}
      <div className={cn("absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full", config.bar)} />

      {/* Top row: label + icon */}
      <div className="flex items-start justify-between pl-3 mb-3">
        <p className="text-[10px] font-semibold text-white/35 uppercase tracking-[0.12em]">{title}</p>
        {icon && (
          <div
            className={cn(
              "w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0",
              config.iconBg,
              config.iconText
            )}
          >
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <div className="pl-3">
        <p
          className="text-[1.75rem] font-bold text-white/90 tracking-tight leading-none"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </p>

        {/* Trend row */}
        {hasTrend && (
          <div className="flex items-center gap-1.5 mt-2">
            {isPositiveTrend ? (
              <TrendingUp className={cn("h-3 w-3 flex-shrink-0", config.trendUp)} />
            ) : (
              <TrendingDown className={cn("h-3 w-3 flex-shrink-0", config.trendDown)} />
            )}
            <span className={cn("text-xs font-semibold", isPositiveTrend ? config.trendUp : config.trendDown)}>
              {isPositiveTrend ? "+" : ""}
              {trend.toFixed(1)}%{trendLabel ? ` ${trendLabel}` : ""}
            </span>
          </div>
        )}

        {subtitle && (
          <p className="text-[11px] text-white/25 mt-1.5 truncate">{subtitle}</p>
        )}
      </div>

      {/* Inline sparkline — rendered in a bottom strip */}
      {hasSparkline && (
        <div className="mt-4 pl-3 -mx-5 -mb-5 px-5 pb-0 overflow-hidden">
          <Sparkline
            data={sparklineData}
            color={resolvedSparkColor}
            height={40}
            strokeWidth={1.5}
            className="w-full"
          />
        </div>
      )}

      {/* Hover shimmer */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.025] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}
