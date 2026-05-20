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
    <div className={cn("flex gap-3 mb-4", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        )}
      >
        {formatAssistantMessage(message.content, isUser)}
      </div>
    </div>
  );
}

function formatAssistantMessage(content: string, isUser: boolean) {
  if (isUser) return <span>{content}</span>;

  // Format: bold numbers and key terms
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
      })}
    </span>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3 mb-4">
      <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
        <Bot className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:0ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:150ms]" />
        <span className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:300ms]" />
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
      content: "Hi! I'm your Finance OS AI assistant. Ask me anything about your financial data — runway, burn, collections, forecasts, or what to prioritise this week.",
      createdAt: new Date(),
    },
  ]);
  const [input, setInput] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Handle ?ask= query param (from quick action links)
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

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer ?? "I couldn't process that. Please try again.",
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
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
    <div className="flex gap-4 h-[calc(100vh-theme(spacing.16)-theme(spacing.12))] max-w-[1400px]">
      {/* Chat panel */}
      <div className="flex flex-col flex-1 min-w-0 bg-card border rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border flex-shrink-0">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Finance Intelligence</p>
            <p className="text-xs text-muted-foreground">Powered by Claude</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {isLoading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-3 flex-shrink-0">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your finances… (Enter to send, Shift+Enter for new line)"
              rows={2}
              className="flex-1 resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0 disabled:opacity-50"
              disabled={isLoading}
            />
            <Button
              size="icon"
              onClick={() => sendMessage()}
              disabled={isLoading || !input.trim()}
              className="flex-shrink-0 h-10 w-10"
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
      <div className="w-64 flex-shrink-0 hidden md:flex flex-col gap-3">
        <div className="bg-card border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Quick Asks
          </p>
          <div className="space-y-1.5">
            {QUICK_ASKS.map((ask) => (
              <button
                key={ask}
                onClick={() => sendMessage(ask)}
                disabled={isLoading}
                className="w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-muted transition-colors text-foreground disabled:opacity-50"
              >
                {ask}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <p className="text-xs font-semibold text-primary mb-2">Pro tip</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ask follow-up questions in context. Try{" "}
            <span className="text-foreground font-medium">"Why?"</span> after any answer to dig deeper.
          </p>
        </div>
      </div>
    </div>
  );
}
