import * as React from "react";

/**
 * Consistent page header used across dashboard routes: a big page title (+ optional
 * subtitle) on the left, and a slot for controls on the right (date-range filter,
 * actions). The AI assistant is reached via the floating co-pilot button.
 */
export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight text-foreground text-balance">{title}</h1>
        {subtitle && <p className="text-[12.5px] text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
