"use client";

import {
  BarChart,
  Bar,
  XAxis,
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

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  let displayDate = label as string;
  try {
    displayDate = format(parseISO((label as string) + "-01"), "MMMM yyyy");
  } catch {
    displayDate = label as string;
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0d1428]/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl">
      <p className="text-white/40 text-[10.5px] font-bold tracking-[0.1em] uppercase mb-1.5">{displayDate}</p>
      <p className="num font-bold text-white/90 text-[15px]">
        {formatCurrency(payload[0].value ?? 0, "INR", false)}
      </p>
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
      <div className="flex items-center justify-center text-white/25 text-sm" style={{ height }}>
        No revenue data available
      </div>
    );
  }

  const lastIdx = data.length - 1;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
        <XAxis
          dataKey="month"
          tickFormatter={formatXAxis}
          tick={{ fontSize: 10.5, fill: "rgba(255,255,255,0.28)", fontFamily: "inherit" }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ fill: "rgba(255,255,255,0.03)", radius: 4 }}
        />
        <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
          {data.map((_, index) => (
            <Cell
              key={index}
              fill="#7c52f0"
              opacity={index === lastIdx ? 0.95 : 0.38}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
