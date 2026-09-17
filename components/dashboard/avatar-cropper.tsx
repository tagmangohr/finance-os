"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X, Upload, RefreshCw, ZoomIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const VIEW = 260;   // on-screen crop square (px)
const OUT = 512;    // exported image size (px)
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Dependency-free avatar upload + square crop. Pick a file → pan (drag) & zoom → save.
 * Renders the crop to a canvas, uploads the JPEG to the `avatars` bucket under the
 * user's own uid prefix (migration 130), stores the public URL on auth metadata
 * (user_metadata.avatar_url), and calls onUploaded with the new URL.
 */
export function AvatarCropper({
  userId,
  onClose,
  onUploaded,
}: {
  userId: string;
  onClose: () => void;
  onUploaded: (url: string) => void;
}) {
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const drag = React.useRef<{ x: number; y: number } | null>(null);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Draw the current view (or export at a larger size) with the same cover+zoom+offset.
  const paint = React.useCallback((ctx: CanvasRenderingContext2D, size: number, off: { x: number; y: number }, z: number) => {
    if (!img) return;
    const scaleFactor = size / VIEW;
    const cover = Math.max(size / img.width, size / img.height);
    const s = cover * z;
    const w = img.width * s, h = img.height * s;
    const x = (size - w) / 2 + off.x * scaleFactor;
    const y = (size - h) / 2 + off.y * scaleFactor;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, x, y, w, h);
  }, [img]);

  // Clamp offset so the image always fully covers the square.
  const clamp = React.useCallback((off: { x: number; y: number }, z: number) => {
    if (!img) return off;
    const cover = Math.max(VIEW / img.width, VIEW / img.height);
    const s = cover * z;
    const w = img.width * s, h = img.height * s;
    const mx = Math.max(0, (w - VIEW) / 2);
    const my = Math.max(0, (h - VIEW) / 2);
    return { x: Math.max(-mx, Math.min(mx, off.x)), y: Math.max(-my, Math.min(my, off.y)) };
  }, [img]);

  React.useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    const ctx = c.getContext("2d");
    if (ctx) paint(ctx, VIEW, offset, zoom);
  }, [img, offset, zoom, paint]);

  const onFile = (file: File | undefined) => {
    setErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("Please choose an image file."); return; }
    if (file.size > MAX_BYTES) { setErr("Image is too large (max 8 MB)."); return; }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { setImg(image); setZoom(1); setOffset({ x: 0, y: 0 }); URL.revokeObjectURL(url); };
    image.onerror = () => { setErr("Couldn't read that image."); URL.revokeObjectURL(url); };
    image.src = url;
  };

  const save = async () => {
    if (!img) return;
    setBusy(true); setErr(null);
    try {
      const out = document.createElement("canvas");
      out.width = OUT; out.height = OUT;
      const octx = out.getContext("2d");
      if (!octx) throw new Error("Canvas unavailable");
      paint(octx, OUT, offset, zoom);
      const blob: Blob = await new Promise((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error("Encode failed"))), "image/jpeg", 0.9));

      const supabase = createClient();
      const path = `${userId}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, blob, {
        cacheControl: "3600", upsert: true, contentType: "image/jpeg",
      });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: metaErr } = await supabase.auth.updateUser({ data: { avatar_url: url } });
      if (metaErr) throw new Error(metaErr.message);
      onUploaded(url);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-[14px] font-semibold text-foreground">Profile photo</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:bg-muted"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 flex flex-col items-center gap-4">
          {!img ? (
            <label className="w-full cursor-pointer">
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-10 text-center hover:border-primary/40 transition-colors">
                <Upload className="w-5 h-5 text-muted-foreground" />
                <p className="text-[12.5px] font-medium text-foreground">Choose a photo</p>
                <p className="text-[11px] text-muted-foreground">PNG or JPG, up to 8 MB</p>
              </div>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          ) : (
            <>
              <div
                className="relative overflow-hidden rounded-full border border-border cursor-grab active:cursor-grabbing"
                style={{ width: VIEW, height: VIEW, touchAction: "none" }}
                onMouseDown={(e) => { drag.current = { x: e.clientX - offset.x, y: e.clientY - offset.y }; }}
                onMouseMove={(e) => { if (drag.current) setOffset(clamp({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }, zoom)); }}
                onMouseUp={() => { drag.current = null; }}
                onMouseLeave={() => { drag.current = null; }}
                onWheel={(e) => { const z = Math.max(1, Math.min(3, zoom + (e.deltaY < 0 ? 0.1 : -0.1))); setZoom(z); setOffset((o) => clamp(o, z)); }}
              >
                <canvas ref={canvasRef} width={VIEW} height={VIEW} />
                <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-white/20" />
              </div>
              <div className="flex items-center gap-2 w-full">
                <ZoomIn className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <input
                  type="range" min={1} max={3} step={0.01} value={zoom}
                  onChange={(e) => { const z = Number(e.target.value); setZoom(z); setOffset((o) => clamp(o, z)); }}
                  className="w-full accent-primary"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">Drag to reposition · scroll or slide to zoom</p>
            </>
          )}

          {err && <p className="text-[11.5px] text-rose-600 text-center">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          {img && (
            <label className="text-[12px] text-muted-foreground hover:text-foreground cursor-pointer px-2 py-1.5">
              Replace
              <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          )}
          <button type="button" onClick={onClose} className="text-[12px] font-medium text-muted-foreground hover:text-foreground rounded-lg px-3 py-1.5">Cancel</button>
          <button
            type="button" disabled={!img || busy} onClick={save}
            className={cn("text-[12px] font-semibold rounded-lg px-3.5 py-1.5 flex items-center gap-1.5", "bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40 disabled:cursor-not-allowed")}
          >
            {busy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving…</> : "Save photo"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
