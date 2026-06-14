"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * App theme provider. attribute="class" so Tailwind's `dark:` variant and our
 * `.dark` CSS-variable block activate. Default is light (the reference-inspired
 * look); the choice is persisted to localStorage by next-themes.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
