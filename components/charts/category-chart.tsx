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
  "hsl(258, 88%, 66%)",   // violet
  "hsl(158, 64%, 48%)",   // emerald
  "hsl(38, 92%, 56%)",    // amber
  "hsl(199, 89%, 54%)",   // sky
  "hsl(330, 81%, 62%)",   // pink
  "hsl(174, 72%, 40%)",   // teal
  "hsl(290, 70%, 60%)",   // purple
  "hsl(15, 80%, 58%)",    // orange
];

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0d1428]/90 backdrop-blur-md px-3.5 py-2.5 text-sm shadow-xl">
      <p className="font-semibold text-white/85 mb-1.5">{entry.name}</p>
      <p className="text-white/45 text-xs">
        {formatCurrency((entry.value as number) ?? 0, "INR", true)}
      </p>
      <p className="text-white/30 text-xs mt-0.5">
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
          <span className="truncate text-white/35">{entry.value}</span>
          <span className="ml-auto text-white/55 font-medium pl-2 flex-shrink-0">
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
      <div className="flex items-center justify-center h-64 text-white/25 text-sm">
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
            <Cell
              key={index}
              fill={COLORS[index % COLORS.length]}
              opacity={0.85}
            />
          ))}
        </Pie>
        <text
          x="35%"
          y="48%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: "10px", fill: "rgba(255,255,255,0.25)", fontWeight: 500 }}
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
