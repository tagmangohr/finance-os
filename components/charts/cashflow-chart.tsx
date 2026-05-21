"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface CashFlowChartProps {
  data: { date: string; inflow: number; outflow: number; balance: number }[];
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  let displayDate = label;
  try {
    displayDate = format(parseISO(label), "dd MMM yyyy");
  } catch {
    displayDate = label;
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0d1428]/90 backdrop-blur-md px-3.5 py-2.5 text-sm shadow-xl min-w-[160px]">
      <p className="text-white/40 text-xs font-medium mb-2">{displayDate}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4 mb-1">
          <span className="text-xs" style={{ color: entry.color }}>
            {(entry.name as string).charAt(0).toUpperCase() + (entry.name as string).slice(1)}
          </span>
          <span className="text-xs font-semibold text-white/80">
            {formatCurrency((entry.value as number) ?? 0, "INR", true)}
          </span>
        </div>
      ))}
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomLegend({ payload }: { payload?: any[] }) {
  if (!payload) return null;
  return (
    <div className="flex items-center justify-center gap-5 pt-3">
      {payload.map((entry: { color: string; value: string }) => (
        <div key={entry.value} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-[11px] text-white/35">
            {entry.value.charAt(0).toUpperCase() + entry.value.slice(1)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CashFlowChart({ data }: CashFlowChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-white/25 text-sm">
        No cash flow data available
      </div>
    );
  }

  const displayData = data.slice(-30);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={displayData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
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
        <Tooltip content={<CustomTooltip />} />
        <Legend content={<CustomLegend />} />
        <Bar
          dataKey="inflow"
          name="Inflow"
          fill="hsl(158, 64%, 48%)"
          opacity={0.7}
          radius={[3, 3, 0, 0]}
        />
        <Bar
          dataKey="outflow"
          name="Outflow"
          fill="hsl(0, 72%, 56%)"
          opacity={0.7}
          radius={[3, 3, 0, 0]}
        />
        <Line
          type="monotone"
          dataKey="balance"
          name="Balance"
          stroke="hsl(258, 88%, 66%)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(258, 88%, 66%)" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
