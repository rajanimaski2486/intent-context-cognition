"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  queryId: string;
  active: boolean;
}

export default function AgentTrace({ queryId, active }: Props) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [done, setDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    if (!active) {
      setText("");
      setDone(false);
      setStreaming(false);
      readerRef.current?.cancel();
      readerRef.current = null;
      return;
    }

    let cancelled = false;
    setText("");
    setDone(false);
    setStreaming(true);

    const run = async () => {
      try {
        const resp = await fetch("/api/trace", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query_id: queryId }),
        });

        if (!resp.body) return;
        const reader = resp.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });

          // parse SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") {
              setDone(true);
              setStreaming(false);
              return;
            }
            try {
              const { char } = JSON.parse(payload) as { char: string };
              if (!cancelled) {
                setText((prev) => prev + char);
              }
            } catch {
              // ignore malformed lines
            }
          }
        }
      } catch {
        // silently swallow — never show error on stage
      } finally {
        if (!cancelled) setStreaming(false);
      }
    };

    run();

    return () => {
      cancelled = true;
      readerRef.current?.cancel();
      readerRef.current = null;
    };
  }, [queryId, active]);

  // auto-scroll to bottom as text streams in
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  if (!active) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-950">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${streaming ? "bg-green-500 animate-pulse" : done ? "bg-green-700" : "bg-zinc-600"}`} />
        <span className="text-xs text-zinc-400 uppercase tracking-widest">Agent trace</span>
        <span className="ml-auto text-[10px] text-zinc-600 italic">
          illustrative reasoning — see Execution trace for the query that ran
        </span>
      </div>
      <div
        ref={containerRef}
        className="font-mono text-xs text-green-300 leading-relaxed px-4 py-3 max-h-56 overflow-y-auto whitespace-pre-wrap"
      >
        {text}
        {streaming && <span className="cursor-blink text-green-400">▊</span>}
      </div>
    </div>
  );
}
