# SPEC — AI Insight (Phase 2)

The neutral, plain-language explainer attached to every government-action card
(legislative · executive · judicial). This is GenPop's reputation-bearing front
door, so neutrality is enforced by **architecture** (fixed schema + provenance +
source-alongside + determinism + correction log), not tone alone — per
REBUILD_PLAN §4.

- **Model:** Google Gemini 2.5 Flash, temperature 0.
- **Cache:** `card_ai` table, one row per `(card_id, kind='insight')`, columns
  `content` (JSON string), `input_hash`, `generated_at`. Generated on first view,
  reused until `input_hash` changes.
- **Not for:** `card_type='live'` (news) cards — Insight covers legislative,
  executive, judicial only.

Grounded in three real `cards` rows pasted 2026-06-16: a CourtListener `cafc`
docket (pending, no opinion yet), a LegiScan AL bill (`HB363`), and a Federal
Register proclamation (`2026-11741`).

---

## 0. Source-text acquisition (read this first)

**Critical finding from the real rows:** `cards.raw` holds rich *metadata and
links*, but usually **not the primary legal text inline**. Insight quality depends
on getting that text. The generation step must acquire source text per card_type
before prompting:

| card_type / source | Primary text the model receives | Where it comes from | Risk |
|---|---|---|---|
| Legislative — `congress` | `cards.summary` (CRS summary, already substantive) + bill metadata; optionally the "Formatted Text" version | `summary` column; `raw.textVersions[].formats[]` URL (fetch optional) | Low — CRS summary is real substance |
| Legislative — `legiscan` | Bill text extracted from the latest `raw.texts[].state_link` **PDF** | Must fetch + parse PDF | **High** — `description` is often just the caption (in HB363, `description == title`); real substance is only in the PDF |
| Executive — `fedreg` | Full document text | Fetch `raw.raw_text_url` (plain text, public domain) | Low — fetchable, clean |
| Judicial — `courtlistener` | Opinion text `html_with_citations` | Fetch via `raw.clusters[]` → `sub_opinions[]` | **Conditional** — empty for pending dockets (`raw.clusters == []`), so no holding exists yet |

Rules:
- The fetched primary text is what provenance and `source_snippets` (§3, §4) are
  drawn from. Do **not** generate provenance against fields that aren't in the text
  the model saw.
- If primary text can't be acquired (PDF parser not built, fetch failed, opinion
  absent), **degrade gracefully**: fill only the slots derivable from metadata,
  set the rest to `"Not specified in the source"`, and set
  `content.meta.source_text = "unavailable"` so the UI can show a "summary pending
  full text" state rather than a hallucinated explainer.
- Copyright: all four are public-domain U.S. government text — short, pointed
  quoted snippets are fine; keep them minimal (≤ ~40 words each).

> LegiScan PDF parsing is a prerequisite for good state-bill Insight. Until it
> exists, treat `legiscan` cards as metadata-only (see §1 fallbacks and the chat
> summary's "thin data" note).

---

## 1. The fixed extraction schema

The model fills the **same slots every time** for a given card_type. The structure
decides inclusion (fights selection bias); the model does not choose what to cover.
Output is JSON (§6). Every slot is either **required** (always present; value is
`"Not specified in the source"` when the source lacks it) or **omit-if-absent**
(key omitted entirely when not applicable).

Shared rule: a slot value is **never invented**. If the acquired source text does
not support it, output exactly `"Not specified in the source"`.

### Legislative (congress, legiscan)

| slot | required? | content | when absent |
|---|---|---|---|
| `what_it_does` | required | 1–2 neutral sentences: the action the bill takes | `"Not specified in the source"` |
| `what_changes` | required | concrete from → to (current law/text → new), as a list of `{from, to}` | `"Not specified in the source"` |
| `who_is_affected` | required | persons/entities/agencies the bill binds or affects | `"Not specified in the source"` |
| `effective_date` | omit-if-absent | date/condition the change takes effect | omit |
| `sunset` | omit-if-absent | expiration/repeal date if any | omit |
| `fiscal_note` | omit-if-absent | cost/appropriation if scored (note: LegiScan exposes fiscal-note *existence* via `raw.supplements[]` even when text isn't parsed) | omit |
| `current_status` | required | plain-language status (map of `cards.status`, e.g. `PASSED_CHAMBER` → "Passed the chamber of origin; pending in the second chamber") | from `cards.status` |
| `source_refs` | required | section/citation references the claims rest on | `"Not specified in the source"` |

### Executive (fedreg)

| slot | required? | content | when absent |
|---|---|---|---|
| `what_it_directs` | required | 1–2 neutral sentences: what the action orders | `"Not specified in the source"` |
| `what_changes_operationally` | required | concrete operational change(s) | `"Not specified in the source"` |
| `who_is_bound` | required | agencies/officials/parties directed | `"Not specified in the source"` |
| `effective_date` | omit-if-absent | when it takes effect | omit |
| `legal_authority` | omit-if-absent | statute/constitutional authority cited in the text | omit |
| `current_status` | required | from `cards.status` (e.g. `PROCLAMATION`, `EO_ISSUED`) in plain terms | from `cards.status` |
| `source_refs` | required | section numbers within the document | `"Not specified in the source"` |

### Judicial (courtlistener)

| slot | required? | content | when absent |
|---|---|---|---|
| `what_was_decided` | required | 1–2 neutral sentences | `"Not specified in the source"` (pending: "The case has been filed; no decision has been issued.") |
| `holding` | required | the holding in plain terms | `"Not specified in the source"` |
| `what_changes_going_forward` | required | practical effect of the ruling | `"Not specified in the source"` |
| `still_unresolved` | required | what the opinion leaves open / "too early to tell" | `"Not specified in the source"` |
| `current_status` | required | from `cards.status` (`PENDING`/`ARGUED`/`DECIDED`) | from `cards.status` |
| `source_refs` | required | opinion paragraph/page references | `"Not specified in the source"` |

> Pending dockets (like the real `cafc` Entropic row, `clusters: []`) legitimately
> fill almost every slot with `"Not specified in the source"` — that is correct
> output, not a failure. The UI should render such a card as "filed, not yet
> decided."

---

## 2. Objective-register style guide (embedded in the prompt)

1. **No evaluative adjectives/adverbs.** Banned set (non-exhaustive): *harsh,
   sweeping, common-sense, dangerous, landmark, historic, controversial, tough,
   radical, extreme, modest, bipartisan (as praise), draconian.* Report magnitude
   with **numbers**, not characterizations.
2. **No framing verbs.** Banned: *cracks down, guts, protects, attacks, slashes,
   defends, targets, rolls back.* Use neutral verbs: *changes, sets, removes,
   adds, requires, permits, prohibits, raises, lowers, establishes, repeals.*
3. **Purpose ≠ mechanism.** Report the stated purpose AND the mechanism
   **separately**. Never assert the mechanism achieves the purpose. ("The stated
   purpose is X. The bill does Y." — not "The bill does Y to achieve X.")
4. **Statutory/clinical register, including for grim content.** The data includes
   crime and sexual-offense bills. Write factually and clinically: name the conduct
   in legal terms, state penalties as numbers, **no euphemism and no lurid
   detail**. Do not sensationalize; do not soften.
5. **Numbers over words.** "increases the penalty from a Class C to a Class A
   misdemeanor" — not "toughens penalties."

### Before / after examples

- **Framing verb →** ❌ "The bill cracks down on illegal streaming."
  ✅ "The bill creates a new felony offense for operating a subscription streaming
  service that hosts unlicensed copyrighted works."
- **Evaluative adjective →** ❌ "A sweeping executive order overhauling federal
  hiring." ✅ "An executive order that changes the hiring authority for an
  estimated [N] federal positions, moving them from the competitive service to the
  excepted service."
- **Sensitive topic (real card — AL HB363) →** ❌ "A bill to stop violent thugs
  from disrupting church." ✅ "Creates a criminal offense for intentionally
  disrupting a worship service and sets a criminal penalty. The stated subject is
  Crimes & Offenses. As passed by the House of origin, the penalty level is
  [Not specified in the source — text not parsed]."

---

## 3. Source-alongside-summary requirement

The AI is never the only thing between the user and the source (REBUILD_PLAN §4).

**Generation output must support side-by-side rendering.** For every filled slot,
the model returns a `source_snippets` array: short **verbatim** quotes from the
acquired primary text that back the slot, each with a location pointer.

```json
"source_snippets": [
  { "slot": "what_changes",
    "quote": "A person commits the crime of disruption of a worship service if…",
    "location": "Engrossed text, §1(a)" }
]
```

Rules:
- Quotes are **verbatim** from the source text the model was given (no paraphrase
  inside quotes). ≤ ~40 words each; pick the single most on-point sentence.
- Snippets are public-domain government text — fine to quote, keep minimal.
- **UI contract:** the card detail view renders the slot summary in one column and
  the paired verbatim snippet (with its location and a deep link to
  `cards.source_url` / the text PDF/opinion) alongside it. The explainer never
  appears without a path to the underlying language.
- If no snippet can be quoted for a slot (metadata-only fallback), the slot still
  renders but is visibly marked "derived from bill metadata; full text not yet
  available."

---

## 4. Provenance per claim

Every filled slot carries a `provenance` pointer back to where in the source it
came from. This is both a trust feature and a forcing function (a model that must
cite smuggles less framing).

Output format — each slot value is an object, not a bare string:

```json
"what_changes": {
  "value": [ { "from": "no specific offense", "to": "new misdemeanor offense" } ],
  "provenance": [
    { "type": "bill_section", "ref": "§1(a)" },
    { "type": "history_entry", "ref": "history[15] 2026-02-24 Engrossed" }
  ]
}
```

Provenance `type` vocabulary by source:

| source | provenance `type` values | `ref` form |
|---|---|---|
| congress | `bill_section`, `crs_summary`, `action` | section no., "CRS summary", `latestAction` |
| legiscan | `bill_section`, `history_entry`, `progress_event`, `supplement` | `§…`, `history[i]`, `progress[i]`, `supplements[i]` (fiscal note) |
| fedreg | `doc_section`, `signing` | `Sec. N`, `signing_date` |
| courtlistener | `opinion_paragraph`, `docket_field` | `¶N` / page, `date_argued` etc. |

A slot with value `"Not specified in the source"` carries `"provenance": []`.

---

## 5. Determinism & consistency checks

### Generation params
- `temperature: 0`
- `topP: 1`, `topK: 1` (greedy)
- `candidateCount: 1`
- `responseMimeType: "application/json"` with a `responseSchema` matching the slot
  schema (§6) so output is structurally constrained, not just requested.
- `maxOutputTokens`: ~2,048 (slots are short; protects against runaway output).

### `input_hash` — regenerate only on meaningful change
`input_hash = sha256(canonical_json(inputs))` where `inputs` is the **minimal set
of fields that change the answer**, per source. This is what controls cost: if the
hash matches the stored row, serve the cache and **do not call Gemini**.

| source | fields hashed |
|---|---|
| legiscan | `raw.change_hash` (LegiScan's own content hash — ideal) |
| congress | `cards.status` + `cards.last_action_at` + sha256(`cards.summary`) + `raw.textVersions` latest `date` |
| fedreg | `cards.external_id` (document_number) + sha256 of fetched `raw_text_url` body (immutable once published) |
| courtlistener | `cards.status` + `raw.date_modified` + presence/id of `raw.clusters[0]` |

Also fold a `PROMPT_VERSION` constant into the hash so that shipping a new prompt
or slot schema cleanly invalidates all caches and triggers lazy regeneration.

### Consistency check (spec, not code)
- **Cadence:** weekly cron, off-peak.
- **Sample:** N = 20 cards spanning card_types and sources, chosen at random from
  cards whose `input_hash` is unchanged since last generation.
- **Procedure:** regenerate Insight for the sample; diff the new JSON against the
  stored `content` field-by-field (normalize whitespace). Because temp = 0 and
  inputs are unchanged, output should be **identical**.
- **Flag drift:** any non-identical slot is logged to a `consistency_drift` report
  (card_id, slot, stored vs. new) for human review. Sustained drift on unchanged
  inputs signals a model-version change upstream → bump `PROMPT_VERSION` and
  re-baseline. Do **not** auto-overwrite stored content from the check.

---

## 6. The generation prompt

Stored in `app/lib/aiInsight/prompt.ts`. The app fills `{{…}}` placeholders from
the card + acquired source text. Output is JSON only.

### System prompt (constant)

```
You are a neutral legislative analyst for GenPop. You produce a STRUCTURED,
objective-register explainer of a single U.S. government action. You are not an
advocate, commentator, or journalist. You report what a document does, not whether
it is good, bad, important, or controversial.

HARD RULES:
1. Output ONLY valid JSON matching the provided schema. No prose outside the JSON.
2. Fill every required slot. If the SOURCE TEXT does not support a slot, output the
   exact string "Not specified in the source". NEVER infer, guess, or supply
   outside knowledge.
3. Objective register:
   - No evaluative adjectives/adverbs (harsh, sweeping, landmark, common-sense,
     dangerous, etc.). Use numbers to convey magnitude.
   - No framing verbs (cracks down, guts, protects, attacks). Use neutral verbs
     (changes, sets, removes, requires, permits, establishes, repeals).
   - Report stated PURPOSE and MECHANISM separately. Never claim the mechanism
     achieves the purpose.
   - For crime, sexual-offense, or other grim subject matter: factual and clinical.
     No euphemism, no lurid or sensational detail. State penalties as legal terms
     and numbers.
4. Every filled slot must include:
   - "provenance": pointers to where in the SOURCE TEXT the claim is grounded.
   - "source_snippets" (at the slot level via the value object) where a short
     verbatim quote (<= 40 words) supports the slot. Quotes must be exact.
5. Do not exceed the schema. Do not add slots.
```

### User prompt (templated)

```
CARD TYPE: {{card_type}}            SOURCE: {{source}}
TITLE: {{title}}
CURRENT STATUS (cards.status): {{status}}
JURISDICTION: {{sphere}}{{#region}} / {{region}}{{/region}}

SLOT SCHEMA (fill exactly these keys): {{slot_schema_json_for_card_type}}

SOURCE TEXT (the only ground truth you may use):
"""
{{acquired_primary_text}}
"""

STRUCTURED METADATA (for status, dates, sponsors, fiscal-note existence only —
not a substitute for SOURCE TEXT):
{{trimmed_raw_json}}

Return the JSON object now.
```

### Stored `card_ai.content` shape (example, legislative)

```json
{
  "schema_version": "insight.v1",
  "card_type": "legislative",
  "slots": {
    "what_it_does": { "value": "…", "provenance": [...], "source_snippets": [...] },
    "what_changes": { "value": [ {"from":"…","to":"…"} ], "provenance": [...], "source_snippets": [...] },
    "who_is_affected": { "value": "…", "provenance": [...] },
    "current_status": { "value": "Passed the chamber of origin; pending in the second chamber.", "provenance": [{"type":"docket_field","ref":"cards.status=PASSED_CHAMBER"}] },
    "source_refs": { "value": "…", "provenance": [...] }
  },
  "meta": { "source_text": "available", "model": "gemini-2.5-flash", "prompt_version": "1" }
}
```

`content` is stored as a JSON string; `input_hash` and `generated_at` live in their
own `card_ai` columns.

---

## 7. Correction log

Users can flag an Insight as inaccurate/biased; corrections are recorded publicly.

### Short term — reuse `feedback`
The existing `feedback` table (`id, user_id, content, created_at`) can carry flags
immediately with a JSON convention in `content`:

```json
{ "kind": "insight_flag", "card_id": "<uuid>", "slot": "what_changes",
  "reason": "biased_wording", "note": "…user text…" }
```

This unblocks launch with no migration. Limitation: `feedback` has no resolution
field and no public surface.

### Proper design — later migration (`insight_flags` + `insight_corrections`)

```
insight_flags:
  id uuid pk, card_id uuid → cards, user_id uuid → auth.users,
  slot text, reason text, note text, status text
    (enum: open | reviewing | upheld | rejected), created_at
  RLS: verified users insert; users read own; service role updates status.

insight_corrections (PUBLIC record):
  id uuid pk, card_id uuid → cards, slot text,
  before text, after text, rationale text,
  corrected_at timestamptz, source_flag_id uuid → insight_flags
  RLS: public select; service role writes.
```

- A flag that's `upheld` produces an `insight_corrections` row and triggers
  regeneration (bump the card's effective prompt/version so `input_hash` changes).
- **Public surface:** a per-card "Corrections" disclosure on the card detail view,
  plus a global `/corrections` page — "we show our work, here's every correction"
  (REBUILD_PLAN §4). This is what survives a bad screenshot.

Data each flag needs (minimum): which card, which slot, what's wrong (reason +
free text), who flagged, resolution status. Corrections need: card, slot,
before/after, rationale, timestamp.

---

## 8. Cost & rate-limit plan

**Free-tier reality (Gemini 2.5 Flash, early 2026 — verify against the current
limits page):** ~**10 RPM**, ~**250 requests/day (RPD)**, ~250k TPM. RPD is the
binding constraint and dropped in late 2025.

**This budget is shared.** Topic tagging at ingestion (cards + forum posts) and
forum relevance/moderation also call Gemini on the same project key. AI Insight
does not get all 250 RPD.

Plan:
- **Generate on first view, never eagerly.** An Insight is created the first time a
  user opens a card's detail, then cached in `card_ai` forever until `input_hash`
  changes. Most of the 15,700 cards will never be viewed → never generated.
- **Hard daily cap as a safety valve.** Enforce an Insight-specific cap (recommend
  **150/day**, leaving headroom for tagging + moderation) via an atomic counter:
  a `gemini_budget(day date, feature text, count int)` row incremented in the same
  transaction as the generation call; over cap → serve a "summary generating,
  check back shortly" placeholder instead of calling Gemini. Enforce in the
  Insight service (`app/lib/aiInsight/generate.ts`), not the route handler.
- **No bulk pre-generation.** Do **not** batch-generate all cards. If backfilling
  popular cards is desired, run a slow nightly job that generates at most
  `(daily_cap − today's on-demand usage)` items, prioritized by view count — so
  backfill never starves live first-view generation. At 150/day a full 15,700-card
  backfill would take ~3.5 months, which is fine because it's demand-ordered.
- **Token cost:** inputs are bounded (CRS summary / single opinion / one EO ≈ a few
  thousand tokens; trim opinions to the syllabus + holding sections when very
  long), so TPM is not the constraint — RPD is.
- **Upgrade path:** if first-view demand routinely hits the cap, move the Gemini
  key to a paid tier (Flash is inexpensive) rather than degrading coverage.

---

## Acceptance checks for the developer
1. A pending CourtListener docket (`raw.clusters == []`) yields valid JSON with
   `what_was_decided` = the pending sentence and the rest `"Not specified in the
   source"`, `meta.source_text` reflecting no opinion — and **no fabricated
   holding**.
2. A LegiScan card whose text PDF isn't parsed yet fills `current_status`,
   `who_is_affected` (sponsors), and fiscal-note existence, marks substance slots
   `"Not specified in the source"`, and sets `meta.source_text="unavailable"`.
3. Re-running generation on a card with an unchanged `input_hash` performs **zero**
   Gemini calls.
4. Every non-empty slot carries ≥1 `provenance` entry; sensitive-topic cards
   (e.g. AL HB363) read clinically with no banned adjectives/verbs.
