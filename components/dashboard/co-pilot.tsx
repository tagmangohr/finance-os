"use client";

import * as React from "react";
import { Sparkles, X, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const SEEDS = ["Why is burn up?", "6-mo forecast", "Concentration risk", "Who owes most?"];

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface CoPilotProps {
  orgId: string;
}

/**
 * Floating AI co-pilot — a bottom-right button that opens a popup chat over the
 * intelligence engine (POST /api/intelligence). Replaces the old right-rail and
 * the standalone Intelligence page: one entry point, available on every page.
 */
export function CoPilot({ orgId }: CoPilotProps) {
  const [open, setOpen] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: "assistant",
      text: "I'm watching your numbers. Ask me anything about your finances, or tap a prompt below.",
    },
  ]);
  const [loading, setLoading] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const scrollBottom = () => {
    setTimeout(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, 50);
  };

  React.useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    // Prior turns as history — drop the leading assistant greeting so the API
    // sees a user-first message list.
    const history = messages
      .filter((m, i) => !(i === 0 && m.role === "assistant"))
      .map((m) => ({ role: m.role, content: m.text }));

    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setLoading(true);
    scrollBottom();

    try {
      const res = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId, question: text, history }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.answer ?? data.error ?? "Something went wrong." },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Network error — please try again." }]);
    } finally {
      setLoading(false);
      scrollBottom();
    }
  };

  return (
    <>
      {/* Popup panel */}
      {open && (
        <div
          className="fixed z-[150] flex flex-col bg-popover border border-border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.55)] overflow-hidden animate-scale-in"
          style={{
            right: "20px",
            bottom: "84px",
            width: "370px",
            maxWidth: "calc(100vw - 32px)",
            height: "min(70vh, 560px)",
          }}
        >
          {/* Header */}
          <div className="h-12 px-3.5 border-b border-border flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span
                className="w-3.5 h-3.5 rounded-full animate-orb flex-shrink-0"
                style={{ background: "radial-gradient(circle at 30% 30%, hsl(var(--primary-foreground)), hsl(var(--primary)) 65%)", boxShadow: "0 0 12px hsl(var(--primary)/0.6)" }}
              />
              <span className="text-[13px] font-semibold text-foreground">Co-pilot</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded" title="Close">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Message thread */}
          <div ref={bodyRef} className="flex-1 overflow-y-auto p-3.5 flex flex-col gap-2.5 no-scrollbar">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "text-xs leading-relaxed rounded-xl p-2.5 border",
                  m.role === "assistant"
                    ? "bg-accent/40 border-border border-l-2 border-l-primary/50 text-foreground/80"
                    : "bg-primary/[0.10] border-primary/20 text-foreground/80 ml-4"
                )}
              >
                {m.role === "assistant" && (
                  <div className="text-[9.5px] font-bold tracking-[0.12em] text-muted-foreground/70 uppercase mb-1.5 flex items-center gap-1">
                    <Sparkles className="h-2.5 w-2.5" /> Co-pilot
                  </div>
                )}
                <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
              </div>
            ))}
            {loading && (
              <div className="bg-accent/40 border border-border border-l-2 border-l-primary/50 rounded-xl p-2.5">
                <div className="text-[9.5px] font-bold tracking-[0.12em] text-muted-foreground/70 uppercase mb-1.5 flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" /> thinking
                </div>
                <div className="flex gap-1">
                  {[0, 150, 300].map((d) => (
                    <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary/50" style={{ animation: `t-typing 1.2s ${d}ms infinite` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Seed prompts */}
          <div className="px-3.5 pb-2 flex flex-wrap gap-1.5 flex-shrink-0">
            {SEEDS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={loading}
                className="h-[22px] px-2 rounded text-[10.5px] text-muted-foreground bg-accent/40 border border-border hover:bg-accent hover:text-foreground transition-all disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-1 border-t border-border flex gap-1.5 flex-shrink-0">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="Ask co-pilot…"
              className="flex-1 h-[32px] px-2.5 rounded-lg bg-accent/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="w-[32px] h-[32px] rounded-lg bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-primary/80 transition-colors"
            >
              <Send className="h-3.5 w-3.5 text-white" />
            </button>
          </div>
        </div>
      )}

      {/* Floating trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title={open ? "Close co-pilot" : "Ask co-pilot"}
        aria-label="Ask co-pilot"
        className={cn(
          "fixed z-[151] bottom-5 right-5 rounded-full flex items-center justify-center shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all hover:scale-105 active:scale-95",
          open ? "bg-accent border border-border text-foreground" : "bg-primary text-white"
        )}
        style={{ height: "52px", width: "52px" }}
      >
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
      </button>
    </>
  );
}
