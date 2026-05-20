"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";

interface RevenueChartProps {
  data: { month: string; amount: number }[];
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  let displayDate = label;
  try {
    displayDate = format(parseISO(label + "-01"), "MMMM yyyy");
  } catch {
    displayDate = label;
  }

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2.5 text-sm">
      <p className="text-muted-foreground mb-1">{displayDate}</p>
      <p className="font-semibold text-foreground">
        {formatCurrency(payload[0].value ?? 0, "INR", false)}
      </p>
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
    return format(parseISO(value + "-01"), "MMM");
  } catch {
    return value;
  }
}

export function RevenueChart({ data }: RevenueChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No revenue data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(221.2, 83.2%, 53.3%)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="hsl(221.2, 83.2%, 53.3%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(214.3, 31.8%, 91.4%)" vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={formatXAxis}
          tick={{ fontSize: 12, fill: "hsl(215.4, 16.3%, 46.9%)" }}
          axisLine={false}
          tickLine={false}
          dy={8}
        />
        <YAxis
          tickFormatter={formatYAxis}
          tick={{ fontSize: 11, fill: "hsl(215.4, 16.3%, 46.9%)" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ stroke: "hsl(221.2, 83.2%, 53.3%)", strokeWidth: 1, strokeDasharray: "4 4" }} />
        <Area
          type="monotone"
          dataKey="amount"
          stroke="hsl(221.2, 83.2%, 53.3%)"
          strokeWidth={2}
          fill="url(#revenueGradient)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0, fill: "hsl(221.2, 83.2%, 53.3%)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
