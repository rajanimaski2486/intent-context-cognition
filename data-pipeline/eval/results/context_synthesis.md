# Context layer: averaged vs synthesized session query

Corpus: standard (7522 images) | journeys: 8 | k=10 | judged pairs: 124 | LLM-as-judge: gpt-4o-mini

Judge intent = the neutral 3-turn thread (not either variant's text).

| System | nDCG@10 | P@5 | Recall@10 | MRR | MAP@10 | Judge | Hit@10 |
|---|---|---|---|---|---|---|---|
| Context · averaged vector | 0.633 | 0.700 | 0.678 | 0.833 | 0.610 | 0.633 | 1.000 |
| Context · synthesized query | 0.744 | 0.775 | 0.708 | 0.875 | 0.700 | 0.700 | 1.000 |
| **Δ synth − avg** | +0.111 | | | | | +0.067 | |

### Per-journey nDCG@10

| Journey | avg | synth | Δ |
|---|---|---|---|
| journey_a (Creative Director) | 0.509 | 0.662 | +0.153 |
| journey_b (Developer) | 0.647 | 0.884 | +0.237 |
| journey_c (Brand Marketer) | 0.631 | 0.705 | +0.073 |
| journey_d (Photo Editor) | 0.462 | 0.735 | +0.273 |
| journey_e (UX Researcher) | 0.748 | 0.646 | -0.102 |
| journey_f (Lifestyle Photographer) | 0.817 | 0.904 | +0.086 |
| journey_g (Music Editor) | 0.610 | 0.623 | +0.013 |
| journey_h (Travel Editor) | 0.639 | 0.797 | +0.158 |
