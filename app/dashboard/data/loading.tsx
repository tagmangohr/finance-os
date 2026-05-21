export default function Loading() {
  return (
    <div className="space-y-4 max-w-[1400px] animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-white/[0.05]" />
      <div className="h-5 w-72 rounded-lg bg-white/[0.03]" />
      <div className="h-12 w-full rounded-xl bg-white/[0.03]" />
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-10 w-full rounded-lg bg-white/[0.025]" />
      ))}
    </div>
  );
}
