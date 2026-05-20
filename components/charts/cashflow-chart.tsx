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
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2.5 text-sm min-w-[160px]">
      <p className="text-muted-foreground mb-2 font-medium">{displayDate}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: entry.color }} className="capitalize">
            {entry.name}
          </span>
          <span className="font-semibold text-foreground">
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

export function CashFlowChart({ data }: CashFlowChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No cash flow data available
      </div>
    );
  }

  const displayData = data.slice(-30);

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={displayData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(214.3, 31.8%, 91.4%)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatXAxis}
          tick={{ fontSize: 11, fill: "hsl(215.4, 16.3%, 46.9%)" }}
          axisLine={false}
          tickLine={false}
          dy={8}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={formatYAxis}
          tick={{ fontSize: 11, fill: "hsl(215.4, 16.3%, 46.9%)" }}
          axisLine={false}
          tickLine={false}
          width={56}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
          formatter={(value) =>
            value.charAt(0).toUpperCase() + value.slice(1)
          }
        />
        <Bar dataKey="inflow" name="Inflow" fill="hsl(142.1, 76.2%, 36.3%)" opacity={0.8} radius={[2, 2, 0, 0]} />
        <Bar dataKey="outflow" name="Outflow" fill="hsl(0, 84.2%, 60.2%)" opacity={0.8} radius={[2, 2, 0, 0]} />
        <Line
          type="monotone"
          dataKey="balance"
          name="Balance"
          stroke="hsl(221.2, 83.2%, 53.3%)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
