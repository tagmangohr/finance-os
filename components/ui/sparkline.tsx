"use client";

import * as React from "react";

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

export function Sparkline({
  data,
  color = "hsl(258, 88%, 66%)",
  height = 36,
  strokeWidth = 1.5,
  className,
}: SparklineProps) {
  const stableId = React.useId().replace(/:/g, "");

  if (!data || data.length < 2) return null;

  const width = 100;
  const padY = strokeWidth;
  const innerH = height - padY * 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const xs = data.map((_, i) => (i / (data.length - 1)) * width);
  const ys = data.map((v) => padY + innerH - ((v - min) / range) * innerH);

  const linePoints = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const areaPoints = [
    `0,${height}`,
    ...xs.map((x, i) => `${x},${ys[i]}`),
    `${width},${height}`,
  ].join(" ");

  // Is the last point higher than the first? (upward trend)
  const isUp = data[data.length - 1] >= data[0];
  const trendColor = isUp ? color : "hsl(0, 72%, 56%)";
  const gradId = `sg-${color.replace(/[^a-z0-9]/gi, "")}-${stableId}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={trendColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        points={linePoints}
        fill="none"
        stroke={trendColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      <circle
        cx={xs[xs.length - 1]}
        cy={ys[ys.length - 1]}
        r={strokeWidth + 1}
        fill={trendColor}
        opacity={0.9}
      />
    </svg>
  );
}
