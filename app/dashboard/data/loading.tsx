export default function Loading() {
  return (
    <div className="space-y-4 max-w-[1400px] animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-accent/40" />
      <div className="h-5 w-72 rounded-lg bg-accent/40" />
      <div className="h-12 w-full rounded-xl bg-accent/40" />
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-10 w-full rounded-lg bg-accent/40" />
      ))}
    </div>
  );
}
