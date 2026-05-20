import * as React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type Severity = "good" | "warning" | "critical" | "neutral";

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  severity?: Severity;
}

const severityBorderClass: Record<Severity, string> = {
  good: "border-l-4 border-l-green-500",
  warning: "border-l-4 border-l-amber-500",
  critical: "border-l-4 border-l-red-500",
  neutral: "border-l-4 border-l-transparent",
};

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendLabel,
  icon,
  severity = "neutral",
}: MetricCardProps) {
  const isPositiveTrend = trend !== undefined && trend >= 0;
  const hasTrend = trend !== undefined;

  return (
    <Card className={cn("relative overflow-hidden", severityBorderClass[severity])}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">{title}</p>
          <p className="mt-1 text-2xl font-bold text-foreground tracking-tight">{value}</p>
          {hasTrend && (
            <div className="mt-1 flex items-center gap-1">
              {isPositiveTrend ? (
                <TrendingUp className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
              )}
              <span
                className={cn(
                  "text-xs font-medium",
                  isPositiveTrend ? "text-green-600" : "text-red-500"
                )}
              >
                {isPositiveTrend ? "+" : ""}
                {trend.toFixed(1)}%{trendLabel ? ` ${trendLabel}` : ""}
              </span>
            </div>
          )}
          {subtitle && !hasTrend && (
            <p className="mt-1 text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
          {subtitle && hasTrend && (
            <p className="mt-0.5 text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className="ml-3 flex-shrink-0 h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
