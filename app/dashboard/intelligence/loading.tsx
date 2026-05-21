export default function IntelligenceLoading() {
  return (
    <div className="h-full flex gap-4">
      <div className="flex-1 bg-card border border-border rounded-xl flex flex-col animate-pulse">
        <div className="p-5 border-b border-border">
          <div className="h-5 w-32 bg-muted rounded" />
        </div>
        <div className="flex-1 p-5 space-y-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={`flex ${i % 2 === 0 ? "justify-end" : "justify-start"}`}>
              <div className={`h-14 rounded-xl bg-muted ${i % 2 === 0 ? "w-2/3" : "w-3/4"}`} />
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-border">
          <div className="h-10 bg-muted rounded-lg" />
        </div>
      </div>
      <div className="w-64 space-y-3">
        <div className="h-5 w-24 bg-muted rounded animate-pulse" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
