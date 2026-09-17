import { cn } from "@/lib/utils";

/** Two-letter initials from a name (falls back to email, then "?"). */
export function initialsOf(name?: string | null, email?: string | null): string {
  const n = (name ?? "").trim();
  if (n) {
    const parts = n.split(/\s+/);
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : n.slice(0, 2)).toUpperCase();
  }
  const e = (email ?? "").trim();
  return e ? e.charAt(0).toUpperCase() : "?";
}

const SIZES: Record<string, { box: string; text: string }> = {
  xs: { box: "w-6 h-6", text: "text-[10px]" },
  sm: { box: "w-8 h-8", text: "text-[12px]" },
  md: { box: "w-10 h-10", text: "text-[14px]" },
  lg: { box: "w-16 h-16", text: "text-[22px]" },
  xl: { box: "w-20 h-20", text: "text-[26px]" },
};

/**
 * Shared user avatar: shows the uploaded image when present, else a gradient chip with
 * initials. Used in Profile, the sidebar, and Team rows so avatars look identical
 * everywhere. `rounded` picks the corner style (default: soft-square to match the app).
 */
export function UserAvatar({
  name,
  email,
  src,
  size = "md",
  rounded = "xl",
  className,
}: {
  name?: string | null;
  email?: string | null;
  src?: string | null;
  size?: keyof typeof SIZES;
  rounded?: "full" | "xl" | "lg";
  className?: string;
}) {
  const s = SIZES[size];
  const corner = rounded === "full" ? "rounded-full" : rounded === "lg" ? "rounded-lg" : "rounded-2xl";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? email ?? "avatar"}
        className={cn(s.box, corner, "flex-shrink-0 object-cover bg-muted select-none", className)}
      />
    );
  }
  return (
    <div
      className={cn(
        s.box, s.text, corner,
        "flex items-center justify-center font-bold text-white flex-shrink-0 select-none bg-gradient-to-br from-primary/70 to-primary/30",
        className,
      )}
      aria-hidden
    >
      {initialsOf(name, email)}
    </div>
  );
}
