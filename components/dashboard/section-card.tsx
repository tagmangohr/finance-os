import * as React from "react";

/** Shared bordered section/panel used across the dashboard tabs. */
export function SectionCard({ title, subtitle, action, children, className }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden transition-all duration-200 hover:border-border/80${className ? " " + className : ""}`}>
      <div className="flex items-center justify-between px-4 pt-3.5 pb-0">
        <div>
          <p className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground">{title}</p>
          {subtitle && <p className="text-[10.5px] text-muted-foreground/70 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="px-4 pb-4 pt-2">{children}</div>
    </div>
  );
}
