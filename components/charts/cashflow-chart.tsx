"use client";

import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface CashFlowChartProps {
  data: { date: string; inflow: number; outflow: number; balance: number }[];
  height?: number;
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  let displayDate = label as string;
  try {
    displayDate = format(parseISO(label as string), "dd MMM yyyy");
  } catch {
    displayDate = label as string;
  }

  const order = ["inflow", "outflow", "balance"];
  const sorted = [...payload].sort(
    (a, b) => order.indexOf(a.dataKey as string) - order.indexOf(b.dataKey as string)
  );

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0d1428]/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl min-w-[160px]">
      <p className="text-white/40 text-[10.5px] font-bold tracking-[0.1em] uppercase mb-2">{displayDate}</p>
      {sorted.map((entry) => {
        const name = (entry.dataKey as string).charAt(0).toUpperCase() + (entry.dataKey as string).slice(1);
        return (
          <div key={entry.dataKey as string} className="flex justify-between gap-4 mb-1 last:mb-0">
            <span className="text-[11px]" style={{ color: entry.color as string }}>{name}</span>
            <span className="num text-[11px] font-semibold text-white/80">
              {formatCurrency((entry.value as number) ?? 0, "INR", true)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatYAxis(value: number): string {
  if (Math.abs(value) >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(0)}K`;
  return `₹${value}`;
}

function formatXAxis(value: string): string {
  try {
    return format(parseISO(value), "dd MMM");
  } catch {
    return value;
  }
}

export function CashFlowChart({ data, height = 280 }: CashFlowChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-white/25 text-sm" style={{ height }}>
        No cash flow data available
      </div>
    );
  }

  const displayData = data.slice(-30);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={displayData} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1db884" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#1db884" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e83a3a" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#e83a3a" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatXAxis}
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
          axisLine={false}
          tickLine={false}
          dy={8}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={formatYAxis}
          tick={{ fontSize: 10, fill: "rgba(255,255,255,0.25)" }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ stroke: "rgba(255,255,255,0.06)", strokeWidth: 1 }}
        />
        <Area
          type="monotone"
          dataKey="inflow"
          stroke="#1db884"
          strokeWidth={1.5}
          fill="url(#inflowGrad)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: "#1db884" }}
        />
        <Area
          type="monotone"
          dataKey="outflow"
          stroke="#e83a3a"
          strokeWidth={1.5}
          fill="url(#outflowGrad)"
          dot={false}
          activeDot={{ r: 3, strokeWidth: 0, fill: "#e83a3a" }}
        />
        <Line
          type="monotone"
          dataKey="balance"
          stroke="#7c52f0"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          activeDot={{ r: 3.5, strokeWidth: 0, fill: "#7c52f0" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
