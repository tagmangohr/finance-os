import * as React from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Consistent page header used across dashboard routes: a big page title (+ optional
 * subtitle) on the left, and a slot for controls on the right (date-range filter,
 * actions). The "Ask Copilot" pill links to the Intelligence page. Complements the
 * top bar (which carries the LIVE badge + global search) rather than duplicating it.
 */
export function PageHeader({
  title,
  subtitle,
  children,
  copilot = true,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  copilot?: boolean;
}) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight text-foreground text-balance">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {children}
        {copilot && (
          <Link
            href="/dashboard/intelligence"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold text-primary bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" /> Ask Copilot
          </Link>
        )}
      </div>
    </div>
  );
}
