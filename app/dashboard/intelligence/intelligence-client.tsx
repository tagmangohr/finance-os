"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Send, Sparkles, Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
}

const QUICK_ASKS = [
  "What's my runway?",
  "Who owes me the most?",
  "Why did burn spike this month?",
  "Am I on track for ₹1Cr ARR?",
  "What should I do this week?",
  "What's my collection rate?",
  "Show me my top expense categories",
  "Am I at risk of missing payroll?",
];

// ── Message bubble ────────────────────────────────────────────────────
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-2.5 mb-3 animate-enter", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex-shrink-0 h-7 w-7 rounded-lg flex items-center justify-center text-[10px] font-bold",
          isUser
            ? "bg-primary/20 border border-primary/30 text-primary"
            : "bg-accent/40 border border-border text-muted-foreground/70"
        )}
      >
        {isUser ? "U" : <Sparkles className="h-3 w-3" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[82%] rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed",
          isUser
            ? "bg-primary/[0.14] border border-primary/[0.18] text-foreground rounded-tr-sm"
            : "bg-accent/40 border border-border text-muted-foreground rounded-tl-sm"
        )}
      >
        {isUser ? (
          <span>{message.content}</span>
        ) : (
          formatAssistantMessage(message.content)
        )}
      </div>
    </div>
  );
}

function formatAssistantMessage(content: string) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
      })}
    </span>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-2.5 mb-3">
      <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-accent/40 border border-border flex items-center justify-center">
        <Sparkles className="h-3 w-3 text-muted-foreground/70" />
      </div>
      <div className="bg-accent/40 border border-border rounded-xl rounded-tl-sm px-3.5 py-2.5 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: "#7c52f0",
              opacity: 0.6,
              animation: `t-typing 1.2s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export function IntelligenceClient() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm your Finance OS AI. Ask me anything about your financial data — runway, burn, collections, forecasts, or what to prioritise this week.",
      createdAt: new Date(),
    },
  ]);
  const [input, setInput] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const ask = searchParams.get("ask") ?? searchParams.get("q");
    if (ask) {
      setInput(ask);
      textareaRef.current?.focus();
    }
  }, [searchParams]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const history = messages
        .filter((m) => m.id !== "welcome")
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: content, history }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.answer ?? "I couldn't process that. Please try again.",
          createdAt: new Date(),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Sorry, I ran into an error. Please try again in a moment.",
          createdAt: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex gap-3 max-w-[1400px]" style={{ height: "calc(100vh - 48px - 30px - 36px - 20px)" }}>

      {/* ── Left panel: quick asks / insight seeds ─────────────────────── */}
      <div className="hidden lg:flex flex-col gap-2 w-[220px] flex-shrink-0 overflow-y-auto">
        {/* Header */}
        <div
          className="rounded-xl border border-border p-3.5"
          style={{ background: "hsl(var(--card))" }}
        >
          <p className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground/70 mb-2.5">Quick Asks</p>
          <div className="space-y-0.5">
            {QUICK_ASKS.map((ask) => (
              <button
                key={ask}
                onClick={() => sendMessage(ask)}
                disabled={isLoading}
                className="w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11.5px] text-muted-foreground hover:text-muted-foreground hover:bg-accent transition-all duration-150 disabled:opacity-40 group"
              >
                <ChevronRight className="h-2.5 w-2.5 text-primary/40 group-hover:text-primary/70 flex-shrink-0" />
                {ask}
              </button>
            ))}
          </div>
        </div>

        {/* Tip */}
        <div
          className="rounded-xl border border-primary/[0.12] p-3"
          style={{ background: "rgba(124,82,240,0.04)" }}
        >
          <p className="text-[9.5px] font-bold tracking-[0.14em] uppercase text-primary/50 mb-1.5">Pro tip</p>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
            Ask follow-up questions in context. Try{" "}
            <span className="text-muted-foreground font-medium">&quot;Why?&quot;</span> after any answer to dig deeper.
          </p>
        </div>
      </div>

      {/* ── Main chat panel ──────────────────────────────────────────── */}
      <div
        className="flex flex-col flex-1 min-w-0 rounded-xl border border-border overflow-hidden animate-scale-in"
        style={{ background: "hsl(var(--card))" }}
      >
        {/* Chat header */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0"
          style={{ background: "hsl(var(--accent))" }}
        >
          <div
            className="h-8 w-8 rounded-xl flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, rgba(124,82,240,0.35), rgba(124,82,240,0.12))",
              border: "1px solid rgba(124,82,240,0.35)",
              boxShadow: "0 0 12px rgba(124,82,240,0.25)",
            }}
          >
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-foreground">Finance Intelligence</p>
            <p className="text-[10.5px] text-muted-foreground/70">Powered by Claude</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px rgba(29,184,132,0.8)" }} />
            <span className="text-[10.5px] text-muted-foreground/70">Online</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div
          className="px-4 pb-4 pt-3 border-t border-border flex-shrink-0"
          style={{ background: "hsl(var(--accent))" }}
        >
          {/* Mobile quick asks */}
          <div className="lg:hidden flex gap-1.5 overflow-x-auto pb-2 mb-2 scrollbar-none">
            {QUICK_ASKS.slice(0, 4).map((ask) => (
              <button
                key={ask}
                onClick={() => sendMessage(ask)}
                disabled={isLoading}
                className="flex-shrink-0 h-6 px-2.5 rounded-full border border-border bg-accent/40 text-[10.5px] text-muted-foreground hover:text-muted-foreground hover:bg-accent transition-all disabled:opacity-40"
              >
                {ask}
              </button>
            ))}
          </div>

          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your finances… (Enter to send)"
              rows={2}
              className="flex-1 resize-none rounded-xl text-[13px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none disabled:opacity-50 transition-all duration-150"
              style={{
                background: "hsl(var(--accent))",
                border: "1px solid hsl(var(--border))",
                padding: "10px 14px",
              }}
              onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "rgba(124,82,240,0.35)"; }}
              onBlur={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = "hsl(var(--border))"; }}
              disabled={isLoading}
            />
            <button
              onClick={() => sendMessage()}
              disabled={isLoading || !input.trim()}
              className="flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center transition-all duration-150 disabled:opacity-30"
              style={{
                background: "rgba(124,82,240,0.9)",
                boxShadow: "0 0 16px rgba(124,82,240,0.35)",
              }}
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              ) : (
                <Send className="h-4 w-4 text-white" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
