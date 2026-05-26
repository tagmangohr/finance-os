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
  icon?: React.ReactNode;
  severity?: Severity;
  sparklineData?: number[];
  sparklineColor?: string;
  className?: string;
}

const severityColor: Record<Severity, string> = {
  good:     "#1db884",
  warning:  "#f59116",
  critical: "#e83a3a",
  neutral:  "#7c52f0",
};

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  severity = "neutral",
  sparklineData,
  sparklineColor,
  className,
}: MetricCardProps) {
  const hasTrend = trend !== undefined;
  const isUp = hasTrend && trend >= 0;
  const color = severityColor[severity];
  const sparkColor = sparklineColor ?? color;
  const hasSparkline = sparklineData && sparklineData.length >= 2;

  return (
    <div
      className={cn(
        "rounded-xl border border-white/[0.06] p-3.5 flex flex-col gap-1 transition-all duration-200 hover:border-white/[0.10] hover:-translate-y-px",
        className
      )}
      style={{ background: "hsl(220 40% 7%)" }}
    >
      {/* Eyebrow + delta */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-white/40">{title}</span>
        {hasTrend && (
          <span
            className="inline-flex items-center gap-0.5 text-[10.5px] font-semibold px-1.5 py-0.5 rounded"
            style={isUp
              ? { background: "rgba(29,184,132,0.10)", color: "#1db884" }
              : { background: "rgba(232,58,58,0.10)", color: "#e83a3a" }
            }
          >
            {isUp ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
            {isUp ? "+" : ""}{trend.toFixed(1)}%{trendLabel ? ` ${trendLabel}` : ""}
          </span>
        )}
      </div>

      {/* Value */}
      <div className="num text-[26px] font-bold tracking-tight leading-[1.1] text-white/90">{value}</div>

      {/* Subtitle */}
      {subtitle && <div className="text-[11px] text-white/35 leading-snug">{subtitle}</div>}

      {/* Sparkline */}
      {hasSparkline && (
        <div className="mt-2">
          <Sparkline data={sparklineData} color={sparkColor} height={32} strokeWidth={1.5} className="w-full" />
        </div>
      )}
    </div>
  );
}
