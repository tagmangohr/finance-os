"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2, ChevronsUpDown, Check, Plus, Loader2, ArrowRight, Globe,
} from "lucide-react";
import { toast } from "sonner";
import { setActiveOrgAction, createOrgAndSwitchAction } from "@/app/org/actions";
import { CURRENCIES, TIMEZONES } from "@/lib/org/org-options";

export type SwitcherOrg = { id: string; name: string; role: "owner" | "admin" | "manager" | "viewer" };

interface OrgSwitcherProps {
  orgs: SwitcherOrg[];
  activeOrgId: string;
  canCreateOrg: boolean;
}

export function OrgSwitcher({ orgs, activeOrgId, canCreateOrg }: OrgSwitcherProps) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

  async function handleSwitch(orgId: string) {
    if (orgId === activeOrgId) return;
    setSwitching(orgId);
    const result = await setActiveOrgAction(orgId);
    if (result?.error) {
      toast.error(result.error);
      setSwitching(null);
      return;
    }
    // Full reload so every server component re-resolves to the new active org.
    window.location.href = "/dashboard";
  }

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className="group flex items-center gap-2 w-full px-2 py-1.5 rounded-lg bg-sidebar-accent/60 border border-sidebar-border hover:bg-sidebar-accent transition-colors outline-none"
            aria-label="Switch organisation"
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 text-white"
              style={{ background: "linear-gradient(135deg, hsl(var(--primary)/0.55), hsl(var(--primary)/0.25))", border: "1px solid hsl(var(--primary)/0.4)" }}
            >
              <Building2 className="w-3 h-3" />
            </div>
            <span className="flex-1 min-w-0 text-left text-[12px] font-medium text-sidebar-foreground truncate">
              {active?.name ?? "Organisation"}
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 text-sidebar-muted group-hover:text-sidebar-foreground flex-shrink-0" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className="z-50 min-w-[208px] rounded-xl border border-border bg-popover p-1.5 shadow-2xl"
            style={{ backdropFilter: "blur(20px)" }}
          >
            <div className="px-2 py-1.5 text-[9.5px] font-bold tracking-[0.16em] text-muted-foreground/70 uppercase">
              Organisations
            </div>

            {orgs.map((org) => (
              <DropdownMenu.Item
                key={org.id}
                onSelect={(e) => { e.preventDefault(); handleSwitch(org.id); }}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] text-foreground/80 hover:bg-accent focus:bg-accent cursor-pointer outline-none"
              >
                <span className="flex-1 min-w-0 truncate">{org.name}</span>
                {org.role !== "owner" && (
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70 flex-shrink-0">{org.role}</span>
                )}
                {switching === org.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />
                ) : org.id === activeOrgId ? (
                  <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                ) : (
                  <span className="w-3.5 flex-shrink-0" />
                )}
              </DropdownMenu.Item>
            ))}

            {canCreateOrg && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  onSelect={(e) => { e.preventDefault(); setCreateOpen(true); }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12.5px] text-foreground/80 hover:bg-accent focus:bg-accent cursor-pointer outline-none"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                  <span>Create organisation</span>
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateOrgDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const result = await createOrgAndSwitchAction({ name: name.trim(), currency, timezone });
      if (result?.error) {
        toast.error(result.error);
        setLoading(false);
        return;
      }
      // New org is now active — full reload into it.
      window.location.href = "/dashboard";
    } catch {
      toast.error("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" style={{ backdropFilter: "blur(2px)" }} />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-popover p-6 shadow-2xl">
          <Dialog.Title className="text-lg font-semibold text-foreground">New organisation</Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mt-1 mb-5">
            Create a separate vertical with its own connectors and data. You can switch between them anytime.
          </Dialog.Description>

          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80 mb-1.5">
                <Building2 className="w-3.5 h-3.5" /> Organisation name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Vertical / business unit name"
                autoFocus
                required
                className="w-full h-10 px-3 rounded-lg border border-border bg-accent/40 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-foreground/80 mb-1.5">Primary currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.value} value={c.value} className="bg-popover">{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[13px] font-medium text-foreground/80 mb-1.5">
                <Globe className="w-3.5 h-3.5" /> Timezone
              </label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-border bg-accent/40 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value} className="bg-popover">{tz.label}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Dialog.Close asChild>
                <button type="button" className="h-9 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground/80 transition-colors">
                  Cancel
                </button>
              </Dialog.Close>
              <button
                type="submit"
                disabled={loading || !name.trim()}
                className="h-9 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Create <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
