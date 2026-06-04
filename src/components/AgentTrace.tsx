"use client";
/* eslint-disable react-hooks/set-state-in-effect -- streaming component: state is reset/advanced inside the fetch effect by design */

import { useEffect, useRef, useState } from "react";
import type { ModelProvider } from "@/lib/provider";
import type { CorpusMode } from "@/lib/opensearch";

interface Props {
  queryId: string;
  active: boolean;
  provider: ModelProvider;
  corpus: CorpusMode;
  /** Render just the streaming text (no outer card/header) for embedding. */
  bare?: boolean;
}

export default function AgentTrace({ queryId, active, provider, corpus, bare = false }: Props) {
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
          body: JSON.stringify({ query_id: queryId, corpus, provider }),
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
              if (!cancelled) setText((prev) => prev + char);
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
  }, [queryId, active, provider, corpus]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [text]);

  if (!active) return null;

  if (bare) {
    return (
      <div
        ref={containerRef}
        className="font-mono text-[11px] text-green-300 leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap"
      >
        {text}
        {streaming && <span className="text-green-400">▊</span>}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${streaming ? "bg-green-500 animate-pulse" : done ? "bg-green-700" : "bg-zinc-600"}`} />
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Agent reasoning</span>
        <span className="ml-auto text-[10px] text-zinc-600 italic">
          illustrative — not part of retrieval
        </span>
      </div>
      <div
        ref={containerRef}
        className="font-mono text-[11px] text-green-300 leading-relaxed px-4 py-3 max-h-56 overflow-y-auto whitespace-pre-wrap"
      >
        {text}
        {streaming && <span className="text-green-400">▊</span>}
      </div>
    </div>
  );
}
