// One-time backfill: canonicalize transactions.counterparty_name so whitespace-only
// variants of the same party ("SWIFT … PVT  LTD" with a double space) collapse to
// ONE identity, matching the new write-path normalization (lib/normalizer
// cleanCounterpartyName). Non-destructive: only collapses runs of whitespace to a
// single space + trims; never changes case or punctuation. Updates only the rows
// that actually differ. Run: node scripts/normalize-counterparty-names.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const clean = (name) => {
  if (name == null) return null;
  const c = String(name).replace(/\s+/g, " ").trim();
  return c || null;
};

// Scan id + counterparty_name in pages; collect only the rows whose name changes.
const diffs = [];
const mapping = new Map(); // before → after (audit)
let scanned = 0;
let lastId = "00000000-0000-0000-0000-000000000000";
for (;;) {
  // Keyset (seek) pagination — WHERE id > lastId ORDER BY id LIMIT n. Offset/range
  // on this 412k-row table hits the 8s statement timeout; keyset walks the PK index.
  const { data, error } = await sb
    .from("transactions")
    .select("id, counterparty_name")
    .gt("id", lastId)
    .order("id", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!rows.length) break;
  scanned += rows.length;
  for (const r of rows) {
    if (r.counterparty_name == null) continue;
    const after = clean(r.counterparty_name);
    if (after !== r.counterparty_name) {
      diffs.push({ id: r.id, after });
      if (!mapping.has(r.counterparty_name)) mapping.set(r.counterparty_name, after);
    }
  }
  lastId = rows[rows.length - 1].id;
  if (rows.length < 1000) break;
}

console.log(`Scanned ${scanned} named rows · ${diffs.length} rows need normalization · ${mapping.size} distinct name variants:\n`);
for (const [before, after] of mapping) console.log(`  "${before}"  →  "${after}"`);

if (!diffs.length) { console.log("\nNothing to update."); process.exit(0); }
if (process.env.DRY) { console.log(`\n[DRY RUN] Would update ${diffs.length} rows. Re-run without DRY=1 to apply.`); process.exit(0); }

// Apply, pooled.
let done = 0, failed = 0;
const CONC = 10;
for (let i = 0; i < diffs.length; i += CONC) {
  const batch = diffs.slice(i, i + CONC);
  const res = await Promise.all(batch.map((d) =>
    sb.from("transactions").update({ counterparty_name: d.after }).eq("id", d.id)
      .then(({ error }) => (error ? (console.error(d.id, error.message), false) : true))
  ));
  done += res.filter(Boolean).length;
  failed += res.filter((x) => !x).length;
}
console.log(`\nUpdated ${done} rows${failed ? ` · ${failed} FAILED` : ""}.`);
