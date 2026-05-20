"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";

interface MobileSidebarWrapperProps {
  org: { id: string; name: string };
  userEmail: string;
}

export function MobileSidebarWrapper({ org, userEmail }: MobileSidebarWrapperProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {/* Trigger button — rendered inside TopBar area via portal is complex, so we inject a fixed button */}
      <button
        className="lg:hidden fixed top-4 left-4 z-40 h-8 w-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-foreground shadow-sm"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 lg:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="relative h-full">
          <button
            className="absolute top-3 right-3 z-10 h-7 w-7 rounded-md bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </button>
          <SidebarNav org={org} userEmail={userEmail} />
        </div>
      </div>
    </>
  );
}
