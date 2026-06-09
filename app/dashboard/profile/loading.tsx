export default function ProfileLoading() {
  return (
    <div className="max-w-2xl space-y-5">
      <div className="space-y-1">
        <div className="h-5 w-32 rounded-lg bg-white/[0.06] animate-pulse" />
        <div className="h-3 w-56 rounded-lg bg-white/[0.04] animate-pulse" />
      </div>
      {[0, 1].map((i) => (
        <div
          key={i}
          className="rounded-2xl p-5 space-y-4"
          style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <div className="h-5 w-40 rounded-lg bg-white/[0.06] animate-pulse" />
          <div className="h-10 rounded-lg bg-white/[0.04] animate-pulse" />
          <div className="h-10 rounded-lg bg-white/[0.04] animate-pulse" />
        </div>
      ))}
    </div>
  );
}
