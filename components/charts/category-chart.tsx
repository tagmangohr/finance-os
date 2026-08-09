"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
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

export function CategoryChart({ data }: CategoryChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[240px] text-muted-foreground text-sm">
        No expense data available
      </div>
    );
  }

  // Donut lives in its OWN fixed square box (cx/cy = 50%, radius < half the box)
  // so it is mathematically impossible to clip — independent of how narrow the
  // card gets on a small laptop. The legend is a separate flexible column that
  // truncates long labels rather than pushing the donut off-screen.
  return (
    <div className="flex items-center gap-4 h-[240px]">
      <div className="relative h-[132px] w-[132px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={64}
              dataKey="amount"
              nameKey="category"
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-medium text-muted-foreground">
          Spend
        </span>
      </div>

      <ul className="flex-1 min-w-0 flex flex-col gap-1.5 text-xs overflow-y-auto max-h-[224px] no-scrollbar">
        {data.map((entry, index) => (
          <li key={index} className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block h-2 w-2 rounded-sm flex-shrink-0"
              style={{ backgroundColor: COLORS[index % COLORS.length] }}
            />
            <span className="truncate text-muted-foreground">{entry.category}</span>
            <span className="ml-auto text-foreground/70 font-medium pl-2 flex-shrink-0">
              {entry.pct?.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
