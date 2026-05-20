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

const COLORS = [
  "hsl(221.2, 83.2%, 53.3%)",
  "hsl(142.1, 76.2%, 36.3%)",
  "hsl(32.1, 94.6%, 43.7%)",
  "hsl(262.1, 83.3%, 57.8%)",
  "hsl(0, 84.2%, 60.2%)",
  "hsl(199, 89%, 48%)",
  "hsl(330, 81%, 60%)",
  "hsl(174, 72%, 40%)",
];

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg px-3 py-2.5 text-sm">
      <p className="font-medium text-foreground mb-1">{entry.name}</p>
      <p className="text-muted-foreground">
        {formatCurrency((entry.value as number) ?? 0, "INR", true)}
      </p>
      <p className="text-muted-foreground">
        {(entry.payload as { pct: number }).pct?.toFixed(1)}% of total
      </p>
    </div>
  );
}

function renderLegend({ payload }: { payload?: Array<{ color: string; value: string; payload: { pct: number; amount: number } }> }) {
  if (!payload) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-xs pl-2">
      {payload.map((entry, index) => (
        <li key={index} className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm flex-shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="truncate text-muted-foreground">{entry.value}</span>
          <span className="ml-auto text-foreground font-medium pl-2 flex-shrink-0">
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
          innerRadius={60}
          outerRadius={90}
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
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-muted-foreground"
          style={{ fontSize: "11px", fontWeight: 500 }}
        >
          Expenses
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
