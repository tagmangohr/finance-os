// Shared option lists for organisation setup — used by the onboarding form and
// the in-dashboard "Create organisation" modal so the two never drift apart.

export const CURRENCIES = [
  { value: "INR", label: "₹ Indian Rupee (INR)" },
  { value: "USD", label: "$ US Dollar (USD)" },
  { value: "EUR", label: "€ Euro (EUR)" },
  { value: "GBP", label: "£ British Pound (GBP)" },
  { value: "AED", label: "د.إ UAE Dirham (AED)" },
  { value: "SGD", label: "S$ Singapore Dollar (SGD)" },
] as const;

export const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (IST, UTC+5:30)" },
  { value: "America/New_York", label: "US Eastern (EST)" },
  { value: "America/Los_Angeles", label: "US Pacific (PST)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Asia/Dubai", label: "Dubai (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore (SGT, UTC+8)" },
] as const;
