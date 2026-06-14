export default function UsersLoading() {
  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="h-5 w-24 rounded-lg bg-accent/40 animate-pulse" />
          <div className="h-3 w-60 rounded-lg bg-accent/40 animate-pulse" />
        </div>
        <div className="h-9 w-36 rounded-lg bg-accent/40 animate-pulse" />
      </div>
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid hsl(var(--border))" }}
      >
        <div
          className="px-4 py-3"
          style={{ background: "hsl(var(--accent))", borderBottom: "1px solid hsl(var(--border))" }}
        >
          <div className="h-3 w-28 rounded bg-accent/40 animate-pulse" />
        </div>
        <div className="p-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-3 rounded-xl border border-border">
              <div className="w-8 h-8 rounded-lg bg-accent/40 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-40 rounded bg-accent/40 animate-pulse" />
                <div className="h-2.5 w-56 rounded bg-accent/40 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
