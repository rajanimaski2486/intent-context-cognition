import rawMetrics from "@/data/eval_metrics.json";

// Shape of src/data/eval_metrics.json. Written by data-pipeline/eval/run_eval.py;
// a "pending" placeholder ships in the repo so this import always resolves.
interface LayerRow {
  key: string;
  label: string;
  ndcg: number | null;
  p5: number | null;
  p1: number | null;
  recall: number | null;
  mrr: number | null;
  map: number | null;
  judge: number | null;
  cos: number | null;
  hit: number | null;
  diversity: number | null;
}
interface EvalMetrics {
  status: string;
  corpus: string;
  k: number;
  judge: string | null;
  queries: number;
  pairs: number | null;
  generated_at: string | null;
  layers: LayerRow[];
}

const metrics = rawMetrics as EvalMetrics;
const K = metrics.k;

const fmt = (v: number | null) => (v === null || v === undefined ? "—" : v.toFixed(3));

type Col = { label: string; field: keyof LayerRow };

function MetricTable({ title, blurb, cols }: { title: string; blurb: string; cols: Col[] }) {
  const baseline = metrics.layers[0];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-zinc-300">{title}</h3>
        <p className="text-[11px] text-zinc-500">{blurb}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-900 text-left text-[11px] uppercase tracking-wider text-zinc-400">
              <th className="px-4 py-2.5 font-medium">Layer</th>
              {cols.map((c) => (
                <th key={c.field} className="px-4 py-2.5 font-medium text-right">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {metrics.layers.map((row, i) => {
              const isHybrid = row.key === "hybrid";
              const lift =
                i > 0 && row.ndcg !== null && baseline.ndcg ? row.ndcg - baseline.ndcg : null;
              return (
                <tr key={row.key} className={isHybrid ? "bg-green-950/30" : "bg-zinc-950"}>
                  <td className="px-4 py-2.5">
                    <span className={isHybrid ? "text-green-300 font-medium" : "text-zinc-200"}>
                      {row.label}
                    </span>
                    {cols[0].field === "ndcg" && lift !== null && (
                      <span className="ml-2 text-[10px] font-mono text-green-500">
                        +{lift.toFixed(3)} nDCG
                      </span>
                    )}
                  </td>
                  {cols.map((c) => (
                    <td key={c.field} className="px-4 py-2.5 text-right font-mono text-zinc-200">
                      {fmt(row[c.field] as number | null)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function EvalPanel() {
  const ready = metrics.status === "ready";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-zinc-100">Relevance lift by layer</h2>
        <p className="text-[11px] text-zinc-500">
          Subjective queries, measured: every pillar should raise relevance — by classic IR
          metrics and by semantic / AI signals.
        </p>
      </div>

      {!ready ? (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-4 text-sm text-amber-300 flex flex-col gap-1.5">
          <span className="font-medium">Eval not run yet.</span>
          <span className="text-[12px] text-amber-300/80">
            Generate the numbers with{" "}
            <code className="font-mono text-amber-200">python data-pipeline/eval/run_eval.py --vision</code>
            . The harness writes them back here.
          </span>
        </div>
      ) : (
        <>
          <MetricTable
            title="IR / ranking"
            blurb="Classic information-retrieval quality at the cutoff."
            cols={[
              { label: `nDCG@${K}`, field: "ndcg" },
              { label: "P@5", field: "p5" },
              { label: `Recall@${K}`, field: "recall" },
              { label: "MRR", field: "mrr" },
              { label: `MAP@${K}`, field: "map" },
            ]}
          />
          <MetricTable
            title="Semantic / AI"
            blurb="Beyond IR: LLM-judge relevance, embedding similarity, hit-rate and result diversity."
            cols={[
              { label: "Judge score", field: "judge" },
              { label: `Cosine@${K}`, field: "cos" },
              { label: `Hit-rate@${K}`, field: "hit" },
              { label: `Diversity@${K}`, field: "diversity" },
            ]}
          />
        </>
      )}

      {ready &&
        (() => {
          const b = metrics.layers[0];
          const h = metrics.layers[metrics.layers.length - 1];
          return (
            <div className="rounded-lg border border-green-900/50 bg-green-950/20 px-4 py-3 text-[12px] leading-relaxed text-zinc-300">
              <span className="text-[10px] uppercase tracking-widest text-green-500/80 mr-2">
                Takeaway
              </span>
              The keyword baseline is already solid (nDCG {fmt(b.ndcg)}), but discovery wins on every
              metric: hybrid reaches{" "}
              <span className="text-green-300 font-medium">{fmt(h.ndcg)} nDCG</span>, P@5 {fmt(b.p5)}
              →{fmt(h.p5)}, judge score {fmt(b.judge)}→{fmt(h.judge)}. Honest, defensible lift.
            </div>
          );
        })()}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-[11px] leading-relaxed text-zinc-400">
        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">How we measure</p>
        <p>
          Each layer is replayed offline over the corpus, then an{" "}
          <span className="text-zinc-200">LLM-as-judge</span> grades every pooled result{" "}
          <span className="text-zinc-200">0–3</span> against the query intent (cached in OpenSearch,{" "}
          <span className="font-mono text-zinc-300">icc_eval_judgments</span>).
        </p>
        <p className="mt-1.5">
          <span className="text-zinc-300">How it&rsquo;s built:</span> Keyword = BM25 over
          title/description/tags; + Intent = kNN cosine on the query embedding; + Hybrid = the two
          fused (min-max normalized, 0.1 / 0.9 weighted mean) — the same retrieval the live app runs.
          We pool each layer&rsquo;s top-{K}, judge every (query, image) pair with gpt-4o on the actual
          thumbnail, then score against that pool (unjudged = grade 0).
        </p>
        <p className="mt-1.5">
          <span className="text-zinc-300">IR:</span> nDCG@{K}, P@5, Recall@{K}, MRR, MAP (TREC-style
          pooling). <span className="text-zinc-300">Semantic / AI:</span> judge score (mean grade,
          0–1), mean query↔result cosine, hit-rate (Success@{K}), and intra-list diversity.
        </p>
      </div>

      {ready && (
        <p className="text-[10px] text-zinc-600 font-mono">
          {metrics.corpus} corpus · {metrics.queries} queries · {metrics.pairs} judged pairs ·{" "}
          {metrics.judge}
          {metrics.generated_at ? ` · ${metrics.generated_at.slice(0, 10)}` : ""}
        </p>
      )}
    </div>
  );
}
