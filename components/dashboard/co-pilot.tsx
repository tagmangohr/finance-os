"use client";

import * as React from "react";
import { Sparkles, ChevronRight, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const SEEDS = ["Why is burn up?", "6-mo forecast", "Concentration risk", "Who owes most?"];

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface CoPilotProps {
  orgId: string;
}

export function CoPilot({ orgId }: CoPilotProps) {
  const [open, setOpen] = React.useState(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem("copilot:open");
    return saved === null ? true : saved === "true";
  });
  const [input, setInput] = React.useState("");
  const [messages, setMessages] = React.useState<Message[]>([
    {
      role: "assistant",
      text: "I'm watching your numbers. Ask me anything about your finances, or pick a seed prompt below.",
    },
  ]);
  const [loading, setLoading] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  const toggleOpen = () => {
    setOpen((p) => {
      localStorage.setItem("copilot:open", String(!p));
      return !p;
    });
  };

  const scrollBottom = () => {
    setTimeout(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }, 50);
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    scrollBottom();

    try {
      const res = await fetch("/api/intelligence/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, org_id: orgId }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", text: data.response ?? data.error ?? "Something went wrong." },
      ]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", text: "Network error — please try again." }]);
    } finally {
      setLoading(false);
      scrollBottom();
    }
  };

  return (
    <aside
      className={cn(
        "relative z-[2] flex-shrink-0 flex flex-col bg-card/85 backdrop-blur-xl border-l border-border transition-all duration-250",
        open ? "w-[280px]" : "w-12"
      )}
    >
      {!open ? (
        /* Collapsed rail */
        <button
          onClick={toggleOpen}
          className="flex flex-col items-center gap-1.5 pt-4 w-full text-muted-foreground hover:text-foreground transition-colors"
          style={{ writingMode: "vertical-rl" }}
        >
          <Sparkles className="h-4 w-4 text-primary mb-2 flex-shrink-0" style={{ writingMode: "horizontal-tb" }} />
          <span className="text-[10px] font-bold tracking-[0.2em] uppercase">AI</span>
        </button>
      ) : (
        <>
          {/* Header */}
          <div className="h-12 px-3.5 border-b border-border flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full animate-orb flex-shrink-0"
                style={{ background: "radial-gradient(circle at 30% 30%, #fff, #7c52f0 65%)", boxShadow: "0 0 12px rgba(124,82,240,0.6)" }} />
              <span className="text-[13px] font-semibold text-foreground">Co-pilot</span>
            </div>
            <button onClick={toggleOpen} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
              <ChevronRight className="h-3.5 w-3.5" />
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
                    : "bg-primary/[0.10] border-primary/20 text-foreground/80 ml-2"
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
                    <span key={d} className="w-1.5 h-1.5 rounded-full bg-primary/50"
                      style={{ animation: `t-typing 1.2s ${d}ms infinite` }} />
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
                className="h-[22px] px-2 rounded text-[10.5px] text-muted-foreground bg-accent/40 border border-border hover:bg-accent hover:text-foreground transition-all"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="px-3 pb-3 pt-1 border-t border-border flex gap-1.5 flex-shrink-0">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(input)}
              placeholder="Ask co-pilot…"
              className="flex-1 h-[30px] px-2.5 rounded-lg bg-accent/40 border border-border text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="w-[30px] h-[30px] rounded-lg bg-primary flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-primary/80 transition-colors"
            >
              <Send className="h-3 w-3 text-white" />
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
