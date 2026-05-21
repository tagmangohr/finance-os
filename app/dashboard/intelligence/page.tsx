"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Send, Sparkles, User, Bot, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3 mb-4 animate-enter", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center",
          isUser
            ? "bg-primary/20 border border-primary/30 text-primary"
            : "bg-white/[0.04] border border-white/[0.07] text-white/40"
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary/15 border border-primary/20 text-white/85 rounded-tr-sm"
            : "bg-white/[0.04] border border-white/[0.07] text-white/75 rounded-tl-sm"
        )}
      >
        {formatAssistantMessage(message.content, isUser)}
      </div>
    </div>
  );
}

function formatAssistantMessage(content: string, isUser: boolean) {
  if (isUser) return <span>{content}</span>;

  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-white/90">{part.slice(2, -2)}</strong>;
        }
        return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
      })}
    </span>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-white/[0.04] border border-white/[0.07] flex items-center justify-center">
        <Bot className="h-3.5 w-3.5 text-white/30" />
      </div>
      <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}

export default function IntelligencePage() {
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
    const ask = searchParams.get("ask");
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
    <div className="flex gap-4 h-[calc(100vh-theme(spacing.14)-theme(spacing.10))] max-w-[1400px]">
      {/* Chat panel */}
      <div className="flex flex-col flex-1 min-w-0 bg-card border border-border/60 rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.4)] animate-scale-in">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.05] flex-shrink-0 bg-white/[0.01]">
          <div className="h-8 w-8 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shadow-[0_0_12px_hsl(258_88%_66%/0.2)]">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white/85">Finance Intelligence</p>
            <p className="text-[11px] text-white/30">Powered by Claude</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_hsl(158_64%_48%/0.8)]" />
            <span className="text-[11px] text-white/30">Online</span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-white/[0.05] p-4 flex-shrink-0 bg-white/[0.01]">
          <div className="flex gap-2.5 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your finances… (Enter to send)"
              rows={2}
              className="flex-1 resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 disabled:opacity-50 transition-all duration-150"
              disabled={isLoading}
            />
            <Button
              size="icon"
              onClick={() => sendMessage()}
              disabled={isLoading || !input.trim()}
              className="flex-shrink-0 h-11 w-11 rounded-xl shadow-[0_0_16px_hsl(258_88%_66%/0.25)] disabled:opacity-30 disabled:shadow-none transition-all duration-150"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Quick asks panel */}
      <div className="w-60 flex-shrink-0 hidden md:flex flex-col gap-3 animate-enter-delay-1">
        <div className="bg-card border border-border/60 rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
          <p className="text-[10px] font-semibold text-white/25 uppercase tracking-widest mb-3">
            Quick Asks
          </p>
          <div className="space-y-1">
            {QUICK_ASKS.map((ask) => (
              <button
                key={ask}
                onClick={() => sendMessage(ask)}
                disabled={isLoading}
                className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-white/[0.04] hover:text-white/75 transition-all duration-150 text-white/40 disabled:opacity-40 group"
              >
                <span className="text-primary/50 mr-1.5 group-hover:text-primary/70">→</span>
                {ask}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-primary/[0.06] border border-primary/15 rounded-2xl p-4">
          <p className="text-[10px] font-semibold text-primary/60 uppercase tracking-widest mb-2">Pro tip</p>
          <p className="text-xs text-white/30 leading-relaxed">
            Ask follow-up questions in context. Try{" "}
            <span className="text-white/55 font-medium">"Why?"</span> after any answer to dig deeper.
          </p>
        </div>
      </div>
    </div>
  );
}
