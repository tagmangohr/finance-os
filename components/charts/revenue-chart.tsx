"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  type TooltipProps,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface RevenueChartProps {
  data: { month: string; amount: number }[];
  height?: number;
}

// Compact ₹ for axis ticks (₹2.9Cr / ₹45L / ₹8K) — keeps the scale readable
// without the verbose full number on every gridline.
function compactINR(n: number): string {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(0)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(0)}K`;
  return `₹${n}`;
}

type Row = { month: string; amount: number; trend: number | null };

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as Row;

  let displayDate = label as string;
  try {
    displayDate = format(parseISO((label as string) + "-01"), "MMMM yyyy");
  } catch {
    displayDate = label as string;
  }

  return (
    <div className="rounded-xl border border-border bg-popover/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
      <p className="text-muted-foreground text-[10.5px] font-bold tracking-[0.1em] uppercase mb-1.5">{displayDate}</p>
      <p className="num font-bold text-popover-foreground text-[15px]">
        {formatCurrency(row.amount ?? 0, "INR", false)}
      </p>
      {row.trend != null && (
        <p className="num text-[11px] text-muted-foreground mt-0.5">
          3-mo avg {formatCurrency(row.trend, "INR", true)}
        </p>
      )}
    </div>
  );
}

function formatXAxis(value: string): string {
  try {
    return format(parseISO(value + "-01"), "MMM");
  } catch {
    return value;
  }
}

export function RevenueChart({ data, height = 260 }: RevenueChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height }}>
        No revenue data available
      </div>
    );
  }

  // Trailing 3-month moving average → the trend line. Smooths the month-to-month
  // spikiness so the direction of the business is legible at a glance; null until
  // there are 3 points so the line doesn't start on a misleading partial average.
  const rows: Row[] = data.map((d, i) => {
    const window = data.slice(Math.max(0, i - 2), i + 1);
    const trend = i >= 2 ? window.reduce((s, w) => s + w.amount, 0) / window.length : null;
    return { month: d.month, amount: d.amount, trend };
  });

  const lastIdx = rows.length - 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
        <XAxis
          dataKey="month"
          tickFormatter={formatXAxis}
          tick={{ fontSize: 10.5, fill: "hsl(var(--muted-foreground))", fontFamily: "inherit" }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <YAxis
          tickFormatter={compactINR}
          tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "inherit" }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickCount={4}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ fill: "hsl(var(--muted-foreground) / 0.08)", radius: 4 }}
        />
        <Bar dataKey="amount" radius={[3, 3, 0, 0]} barSize={26} isAnimationActive={false}>
          {rows.map((_, index) => (
            <Cell
              key={index}
              fill="hsl(var(--chart-cash))"
              opacity={index === lastIdx ? 1 : 0.4}
            />
          ))}
        </Bar>
        <Line
          type="monotone"
          dataKey="trend"
          stroke="hsl(var(--metric-revenue))"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 3 }}
          connectNulls
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
