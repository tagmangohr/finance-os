"use client";

import * as React from "react";
import { AlertTriangle, AlertCircle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntelligenceAlert } from "@/lib/supabase/types";

interface AlertBannerProps {
  alerts: IntelligenceAlert[];
}

const severityConfig = {
  critical: {
    chipClass: "bg-red-500/[0.08] border-red-500/25 text-red-300 hover:bg-red-500/[0.12]",
    iconClass: "text-red-400",
    dot: "bg-red-400",
    glow: "shadow-[0_0_12px_hsl(0_72%_56%/0.15)]",
    Icon: AlertCircle,
  },
  warning: {
    chipClass: "bg-amber-500/[0.08] border-amber-500/25 text-amber-300 hover:bg-amber-500/[0.12]",
    iconClass: "text-amber-400",
    dot: "bg-amber-400",
    glow: "shadow-[0_0_12px_hsl(38_92%_56%/0.15)]",
    Icon: AlertTriangle,
  },
  info: {
    chipClass: "bg-primary/[0.08] border-primary/25 text-primary/80 hover:bg-primary/[0.12]",
    iconClass: "text-primary/70",
    dot: "bg-primary/60",
    glow: "",
    Icon: Info,
  },
};

export function AlertBanner({ alerts }: AlertBannerProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const topAlerts = alerts.slice(0, 3);

  if (topAlerts.length === 0) return null;

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-0.5 no-scrollbar animate-enter">
      {topAlerts.map((alert) => {
        const config = severityConfig[alert.severity];
        const { Icon } = config;
        const isExpanded = expandedId === alert.id;

        return (
          <div
            key={alert.id}
            className={cn(
              "flex-shrink-0 rounded-xl border px-3.5 py-2.5 cursor-pointer transition-all duration-200 max-w-xs",
              config.chipClass,
              config.glow
            )}
            onClick={() => setExpandedId(isExpanded ? null : alert.id)}
          >
            <div className="flex items-center gap-2">
              <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0 animate-pulse", config.dot)} />
              <Icon className={cn("h-3.5 w-3.5 flex-shrink-0", config.iconClass)} />
              <span className="text-xs font-medium truncate">{alert.title}</span>
              {isExpanded ? (
                <ChevronUp className="h-3 w-3 flex-shrink-0 ml-auto opacity-50" />
              ) : (
                <ChevronDown className="h-3 w-3 flex-shrink-0 ml-auto opacity-50" />
              )}
            </div>
            {isExpanded && (
              <p className="mt-2 text-xs opacity-70 leading-relaxed max-w-64 pl-6">
                {alert.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
