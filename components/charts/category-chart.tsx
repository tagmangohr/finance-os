"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

interface CategoryChartProps {
  data: { category: string; amount: number; pct: number }[];
}

// Per-slice identity colors via theme tokens (vivid in light + dark).
const COLORS = [
  "hsl(var(--metric-revenue))",
  "hsl(var(--metric-margin))",
  "hsl(var(--metric-opex))",
  "hsl(var(--metric-cash))",
  "hsl(var(--metric-runway))",
  "hsl(var(--metric-profit))",
  "hsl(var(--chart-1))",
  "hsl(var(--chart-3))",
];

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-xl border border-border bg-popover/90 backdrop-blur-md px-3.5 py-2.5 text-sm shadow-xl">
      <p className="font-semibold text-popover-foreground mb-1.5">{entry.name}</p>
      <p className="text-muted-foreground text-xs">
        {formatCurrency((entry.value as number) ?? 0, "INR", true)}
      </p>
      <p className="text-muted-foreground/70 text-xs mt-0.5">
        {(entry.payload as { pct: number }).pct?.toFixed(1)}% of total
      </p>
    </div>
  );
}

function renderLegend({
  payload,
}: {
  payload?: Array<{ color: string; value: string; payload: { pct: number; amount: number } }>;
}) {
  if (!payload) return null;
  return (
    <ul className="flex flex-col gap-2 text-xs pl-2">
      {payload.map((entry, index) => (
        <li key={index} className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="truncate text-muted-foreground">{entry.value}</span>
          <span className="ml-auto text-foreground/70 font-medium pl-2 flex-shrink-0">
            {entry.payload.pct?.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CategoryChart({ data }: CategoryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        No expense data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          cx="35%"
          cy="50%"
          innerRadius={58}
          outerRadius={88}
          dataKey="amount"
          nameKey="category"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <text
          x="35%"
          y="48%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "10px", fill: "hsl(var(--muted-foreground))", fontWeight: 500 }}
        >
          Spend
        </text>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          layout="vertical"
          align="right"
          verticalAlign="middle"
          content={renderLegend as unknown as React.ReactElement}
          iconType="square"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
