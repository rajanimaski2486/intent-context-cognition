"""
One-time script: inject Journey A and Journey B (with empty embeddings)
into queries_standard.json and queries_extended.json.

Run: python data-pipeline/add_journeys.py
Idempotent — skips if journeys array already exists.
"""

import json
import os

REPO = os.path.join(os.path.dirname(__file__), "..")
STANDARD = os.path.join(REPO, "src", "data", "queries_standard.json")
EXTENDED = os.path.join(REPO, "src", "data", "queries_extended.json")

JOURNEY_A = {
    "id": "journey_a",
    "pillar": "journey",
    "label": "Creative Director",
    "subtitle": "A mindfulness campaign takes shape",
    "visible_in": ["standard", "extended"],
    "steps": [
        {
            "step": 1,
            "pillar_demonstrated": "intent",
            "label": "Finding the feeling",
            "narrative": "The brief is a feeling, not a keyword. The system encodes the paradox — stillness with presence — as a single vector.",
            "display_text": "stillness that doesn't feel empty",
            "bm25_keywords": "stillness calm room",
            "embedding": [],
            "session_accumulated_embedding": [],
            "session_accumulates": True,
            "show_trace": False,
            "trace_template": None,
            "signal_labels": ["paradox encoded", "inhabited calm", "no keyword anchor"],
            "speaker_note": "Watch the left panel — BM25 returns empty rooms and still life. The designer meant something entirely different.",
        },
        {
            "step": 2,
            "pillar_demonstrated": "context",
            "label": "Building on what we found",
            "narrative": "The session carries what we established. Quiet is not re-stated — it is inherited. The system remembers.",
            "display_text": "add a human presence, but keep that quiet",
            "bm25_keywords": "human presence quiet person",
            "embedding": [],
            "session_accumulated_embedding": [],
            "session_accumulates": True,
            "show_trace": False,
            "trace_template": None,
            "signal_labels": ["session-conditioned", "quiet register preserved", "additive human signal"],
            "speaker_note": "The Legacy panel reset completely. The Discovery panel shifted — human presence arrived without losing the quiet. They did not start over.",
        },
        {
            "step": 3,
            "pillar_demonstrated": "cognition",
            "label": "Resolving the brief",
            "narrative": "Conflicting modifiers. The agent decomposes the contradiction, applies the session context, and finds the intersection.",
            "display_text": "make it feel aspirational but not out of reach",
            "bm25_keywords": "aspirational lifestyle",
            "embedding": [],
            "session_accumulated_embedding": [],
            "session_accumulates": True,
            "show_trace": True,
            "trace_template": {
                "steps": [
                    "Query received. Parsing modifier structure...",
                    "Conflicting modifiers detected: [aspirational] vs [not out of reach].",
                    "Session context active: stillness, quiet human presence, mindfulness register.",
                    "Decomposing into sub-queries:",
                    "  Sub-query 1: aspirational within established visual register — elevated but calm",
                    "  Sub-query 2: accessible, everyday moments of peace — not luxury, not distant",
                    "Routing sub-query 1 to k-NN with session vector weight...",
                    "Routing sub-query 2 to k-NN with session vector weight...",
                    "Computing intersection: images scoring high on both aspirational and accessible axes...",
                    "Applying session weight: quiet, human, natural light, mindfulness register...",
                    "Filtering out luxury cluster (cosine sim > 0.88 to 'luxury' anchor)...",
                    "Merging and re-ranking by intersection score...",
                    "Returning top 6 results. The brief was ambiguous. The agent held both.",
                ]
            },
            "signal_labels": ["conflicting modifiers", "agent decomposes", "session context applied", "intersection retrieval"],
            "speaker_note": "The brief was ambiguous. A keyword engine picks one modifier and ignores the other. The agent held both simultaneously. Point at the trace while it streams.",
        },
        {
            "step": 4,
            "pillar_demonstrated": "all",
            "label": "The full journey",
            "narrative": "Three queries. One conversation. Each one more specific than the last. None of them containing a useful keyword.",
            "display_text": None,
            "bm25_keywords": None,
            "embedding": None,
            "session_accumulated_embedding": None,
            "session_accumulates": False,
            "show_trace": False,
            "trace_template": None,
            "signal_labels": [],
            "speaker_note": "Pause here. Let the audience look at the three columns. Then say: This is not search. This is discovery. Then put up the QR code.",
        },
    ],
}

JOURNEY_B = {
    "id": "journey_b",
    "pillar": "journey",
    "label": "Developer",
    "subtitle": "The future of work, one query at a time",
    "visible_in": ["standard", "extended"],
    "steps": [
        {
            "step": 1,
            "pillar_demonstrated": "intent",
            "label": "Setting the register",
            "narrative": "Not a workplace photo. A feeling of deep focus. The system encodes concentration as atmosphere, not literal space.",
            "display_text": "the feeling of being completely absorbed in your work",
            "bm25_keywords": "focused work office laptop",
            "embedding": [],
            "session_accumulated_embedding": [],
            "session_accumulates": True,
            "show_trace": False,
            "trace_template": None,
            "signal_labels": ["focus as atmosphere", "concept over literal space", "no room keyword needed"],
            "speaker_note": "BM25 returns desk setups and office stock photos. Discovery returns the feeling — the posture, the light, the absence of distraction.",
        },
        {
            "step": 2,
            "pillar_demonstrated": "context",
            "label": "Adding energy without losing focus",
            "narrative": "The session carries the focus register. Energy is added — but conditioned by what came before. It does not override it.",
            "display_text": "now bring in some human energy, collaborative",
            "bm25_keywords": "people working together collaboration team",
            "embedding": [],
            "session_accumulated_embedding": [],
            "session_accumulates": True,
            "show_trace": False,
            "trace_template": None,
            "signal_labels": ["session-conditioned", "energy layered onto focus", "collaboration not chaos"],
            "speaker_note": "Legacy panel reset. Returns generic team meetings. Discovery keeps the focus register and adds people — small groups, whiteboards, not boardrooms.",
        },
        {
            "step": 3,
            "pillar_demonstrated": "cognition",
            "label": "Defining the future without a template",
            "narrative": "The future of work is not a visual cliche. The agent must exclude the past before it can find the future.",
            "display_text": "make it feel like the future of work, not the past",
            "bm25_keywords": "future work modern technology",
            "embedding": [],
            "session_accumulated_embedding": [],
            "session_accumulates": True,
            "show_trace": True,
            "trace_template": {
                "steps": [
                    "Query received. Parsing temporal contrast signal...",
                    "Temporal contrast detected: [future of work] vs [not the past].",
                    "Session context active: focused, collaborative, small-group energy register.",
                    "Building visual exclusion list for 'the past of work':",
                    "  Exclude: cubicles, suits, fluorescent lighting, formal boardrooms,",
                    "  desktop towers, landline phones, rigid desk rows.",
                    "Expanding 'future of work' within session register:",
                    "  Include: flexible spaces, natural light, casual attire with intent,",
                    "  async collaboration, visible wellbeing, human-scale environments.",
                    "Routing to k-NN with session vector weight applied...",
                    "Filtering out past-of-work visual cluster...",
                    "Scoring by temporal-forward signal: openness, flexibility, human agency...",
                    "Re-ranking by intersection with focus + collaboration session context...",
                    "Returning top 6 results. The future looks like people, not furniture.",
                ]
            },
            "signal_labels": ["temporal contrast", "exclusion list built", "future without cliche", "session-grounded"],
            "speaker_note": "The agent knows what the past of work looks like — and excludes it. Then finds the future within the register the session already built.",
        },
        {
            "step": 4,
            "pillar_demonstrated": "all",
            "label": "The full journey",
            "narrative": "Absorption. Collaboration. The future. Three ideas built on each other — no keyword did the work.",
            "display_text": None,
            "bm25_keywords": None,
            "embedding": None,
            "session_accumulated_embedding": None,
            "session_accumulates": False,
            "show_trace": False,
            "trace_template": None,
            "signal_labels": [],
            "speaker_note": "For the tech crowd: point at the three columns and say — you built an architecture that understands what people mean. That is OpenSearch as a reasoning substrate, not a passive index.",
        },
    ],
}

JOURNEYS = [JOURNEY_A, JOURNEY_B]


def inject(path: str) -> None:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    if "journeys" in data:
        print(f"  journeys already present in {os.path.basename(path)}, skipping.")
        return

    data["journeys"] = JOURNEYS

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"  Injected {len(JOURNEYS)} journeys into {os.path.basename(path)}")


if __name__ == "__main__":
    print("Injecting journey data into registries...")
    inject(STANDARD)
    inject(EXTENDED)
    print("Done.")
