"use client";

import * as React from "react";
import { AlertTriangle, AlertCircle, Info, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IntelligenceAlert } from "@/lib/supabase/types";

interface AlertBannerProps {
  alerts: IntelligenceAlert[];
}

const severityConfig = {
  critical: {
    chipClass: "bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300",
    iconClass: "text-red-600 dark:text-red-400",
    Icon: AlertCircle,
  },
  warning: {
    chipClass: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300",
    iconClass: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  info: {
    chipClass: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300",
    iconClass: "text-blue-600 dark:text-blue-400",
    Icon: Info,
  },
};

export function AlertBanner({ alerts }: AlertBannerProps) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const topAlerts = alerts.slice(0, 3);

  if (topAlerts.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
      {topAlerts.map((alert) => {
        const config = severityConfig[alert.severity];
        const { Icon } = config;
        const isExpanded = expandedId === alert.id;

        return (
          <div
            key={alert.id}
            className={cn(
              "flex-shrink-0 rounded-lg border px-3 py-2.5 cursor-pointer transition-all max-w-xs",
              config.chipClass
            )}
            onClick={() => setExpandedId(isExpanded ? null : alert.id)}
          >
            <div className="flex items-center gap-2">
              <Icon className={cn("h-4 w-4 flex-shrink-0", config.iconClass)} />
              <span className="text-sm font-medium truncate">{alert.title}</span>
              {isExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 flex-shrink-0 ml-auto opacity-60" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 ml-auto opacity-60" />
              )}
            </div>
            {isExpanded && (
              <p className="mt-1.5 text-xs opacity-80 leading-relaxed max-w-64">
                {alert.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
