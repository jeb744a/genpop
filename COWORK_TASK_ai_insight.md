# Cowork task brief — GenPop AI Insight specification

Paste this into Claude Cowork with the GenPop folder (or its `docs` subfolder)
as the working folder. It reads `REBUILD_PLAN.md` (especially §4), `schema.sql`
(the `card_ai` table), and a few sample rows you'll provide, and produces a build
spec a developer (in Cursor) builds Phase 2 directly from. It does NOT write app
code.

> Safety note: this task READS the plan + schema + sample card data you paste in,
> and WRITES one or two markdown spec files. No autonomous web action needed.

---

## Context

AI Insight is GenPop's reputation-bearing front door: a neutral, plain-language
explainer attached to every government-action card (legislative, executive,
judicial). REBUILD_PLAN §4 is explicit that this is NOT "prompt Gemini and
cache" — neutrality must be enforced by ARCHITECTURE, not just tone. Tone-only
prompting fixes loaded adjectives but not selection bias, structural framing, or
false balance. The spec must address all of those.

The output is cached in the `card_ai` table (see schema.sql): one row per
(card_id, kind='insight'), with `content`, an `input_hash`, and `generated_at`.
Insight is generated on first view and re-used until the source content changes.

The model is Google Gemini 2.5 Flash (free tier), temperature ~0.

Before writing, ask me to paste 2-3 real rows from the `cards` table covering
different card_types (a federal bill, a state bill, an executive order or court
opinion) so the schema is grounded in the actual data shape — especially what's
available in `raw` to feed the model.

---

## Task

Produce `SPEC_ai_insight.md` containing the following sections.

### 1. The fixed extraction schema
Define the exact, fixed set of slots the model MUST fill for every card — the
structure decides what's included, which fights selection bias. Propose slots
per card_type (they'll overlap but differ). Starting point to refine:
- **Legislative:** what it does (1-2 neutral sentences) · what specifically
  changes (from X → to Y, concrete) · who/what is affected · effective date ·
  sunset/expiration if any · cost/fiscal note if available · current status in
  plain terms · source section references.
- **Executive:** what the action directs · what changes operationally · which
  agencies/parties are bound · effective date · legal authority cited if present
  · source reference.
- **Judicial:** what was decided · the holding in plain terms · what it changes
  going forward · what's still unresolved/"too early to tell" · source reference.
Specify, for each slot: whether it's required or "omit if absent," and what the
model outputs when the source genuinely lacks the info ("Not specified in the
source" — never invent).

### 2. The objective-register style guide
Concrete, enforceable writing rules the prompt embeds:
- No evaluative adjectives/adverbs (harsh, sweeping, common-sense, dangerous,
  landmark, etc.). Report magnitude with numbers, not characterizations.
- No framing verbs (cracks down, guts, protects, attacks). Use neutral verbs
  (changes, sets, removes, requires, permits).
- Report stated purpose AND mechanism separately; do not assert that the
  mechanism achieves the purpose.
- Statutory/clinical register — including for grim subject matter (the data
  includes bills on crime, sexual offenses, etc.). Specify how to handle
  sensitive content: factual, clinical, non-sensationalized, no euphemism and no
  lurid detail. Give 2-3 before/after examples (biased phrasing → neutral
  rewrite), including one sensitive-topic example.

### 3. Source-alongside-summary requirement
Per REBUILD_PLAN §4, the AI must never be the only thing between user and source.
Specify how the spec wants the UI to render the explainer next to the primary
text / key quoted provisions, and what the generation step must output to support
that (e.g. short verbatim source snippets paired with each slot, with their
source location). Note copyright/length sensibility — short quoted snippets of
public-domain government text are fine; keep them minimal and pointed.

### 4. Provenance per claim
Specify that each filled slot carries a pointer back to where in the source it
came from (section number, history entry, opinion paragraph). Define the output
format for these pointers so the developer can store and render them.

### 5. Determinism & consistency checks
- Temperature ~0; specify any other generation params.
- Define the `input_hash`: exactly which source fields are hashed so that Insight
  regenerates ONLY when meaningful content changes (e.g. for LegiScan, the
  change_hash; for others, the relevant text/status fields). This controls cost.
- Specify a periodic consistency check: regenerate a sample, diff against stored,
  flag drift. Describe it as a spec, not code.

### 6. The generation prompt
Write the actual Gemini system/user prompt template the developer will use,
parameterized by card_type and the fields pulled from `raw`. It must instruct
the model to output STRUCTURED data (JSON matching the slot schema) so the app
can render slots individually and detect missing ones — not freeform prose.
Constrain output strictly to the schema. Include the instruction to return
"Not specified in the source" rather than infer.

### 7. Correction log
Per REBUILD_PLAN §4: define a lightweight design for users to flag an Insight as
inaccurate/biased, and a public-facing record of corrections. Specify the data
it needs (which card, what was flagged, resolution) — note whether a new table
is needed (if so, describe it; it'll be a later migration) or whether `feedback`
can carry it initially.

### 8. Cost & rate-limit plan
- Estimate Gemini free-tier headroom given generate-on-first-view + aggressive
  caching. Recommend a per-day generation cap as a safety valve and where to
  enforce it.
- Note: do NOT pre-generate Insight for all 15,700 cards at once — generate
  lazily on first view, or batch-backfill slowly within the daily cap.

---

## Output
`SPEC_ai_insight.md` as above. When done, summarize in chat: the hardest
neutrality risk this spec does NOT fully solve (so it's a known limitation, not a
blind spot), and any card_type whose source data is too thin to fill the schema
well (so the developer handles sparse cards gracefully).
