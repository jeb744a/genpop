# How stories get onto GenPop

*Draft copy for the public methodology page (`/methodology`). Source of truth:
SPEC_news_threshold.md §1–§2. Versions shown are placeholders to be rendered
from config at build time.*

---

GenPop's live news feed does not have an editor. No one at GenPop decides
which stories you see. Instead, a story appears only when it passes a fixed,
published rule. This page is that rule, in full, along with what the rule can
and cannot tell you.

## The rule

A story becomes a live card on GenPop only when all three of these are true:

1. **At least 4 of the 12 outlets listed below** have covered it.
2. That coverage happened **within a 48-hour window** of the story first
   appearing in any of their feeds.
3. The outlets covering it **span the political spectrum**: at least one from
   the left-of-center group, one from the center group, and one from the
   right-of-center group.

Until a story clears all three conditions, it does not appear — no matter how
prominently any single outlet covers it. The moment it clears them, it
appears automatically. There is no override in either direction.

Every live card shows its own receipts: which outlets covered the story,
links to each article, when each was published, and the exact time the story
cleared the threshold. You can check our work on any card, at any time.

### The wire-service rule

Many outlets republish articles from wire services like the Associated Press
or Reuters, sometimes word for word. A wire story reprinted by three
newspapers is one newsroom's work appearing four times — not four independent
decisions to cover something. So when an article is credited to a wire
service on our list, it counts as coverage by that wire service, not by the
outlet that republished it, no matter how many outlets ran it. Without this
rule, a single wire story could clear the threshold by itself.

### Each outlet counts once

An outlet that publishes ten articles about a story counts once, the same as
an outlet that publishes one.

## The outlets

The list is 12 outlets: 4 rated left-of-center, 4 rated center, 4 rated
right-of-center.

**We do not rate these outlets ourselves.** Ratings come from
[AllSides](https://www.allsides.com/media-bias/media-bias-chart), an
organization that publishes media bias ratings using multi-partisan panels
and blind surveys. We use AllSides' rating for each outlet's **news**
coverage — not its opinion section, which AllSides rates separately and which
is often rated differently. As a cross-check we also consult the
[Ad Fontes Media Bias Chart](https://adfontesmedia.com/); where the two
disagree, we mark the outlet **contested** below, and the AllSides category
still decides its group. Group assignment is mechanical: Left or Lean Left →
left group; Center → center group; Lean Right or Right → right group.

Ratings retrieved 2026-07-06 from AllSides Media Bias Chart v11.

| Outlet | Group | AllSides rating | Contested? |
|---|---|---|---|
| [The New York Times (News)](https://www.allsides.com/news-source/new-york-times-news-media-bias) | Left | Lean Left | — |
| [The Washington Post](https://www.allsides.com/news-source/washington-post-media-bias) | Left | Lean Left | — |
| [NPR](https://www.allsides.com/news-source/npr-media-bias) | Left | Lean Left | **Yes.** NPR disputes the label, and Ad Fontes places NPR close to the middle with high reliability. |
| [Associated Press](https://www.allsides.com/news-source/associated-press-media-bias) | Left | Lean Left | **Yes.** AllSides describes AP as sitting on the border between Left and Lean Left; Ad Fontes rates AP near the middle. AllSides' category decides, so AP sits in the left group. |
| [Reuters](https://www.allsides.com/news-source/reuters-media-bias) | Center | Center | — |
| [BBC News](https://www.allsides.com/news-source/bbc-news-media-bias) | Center | Center | **Yes.** AllSides' reviews of BBC have moved between Center and Lean Left for years; the current Center rating reflects a panel decision on a borderline number. |
| [The Hill](https://www.allsides.com/news-source/hill-media-bias) | Center | Center | — |
| [The Wall Street Journal (News)](https://www.allsides.com/news-source/wall-street-journal-media-bias) | Center | Center | **Yes.** The Journal's opinion pages are rated separately and lean right; only the news desk is rated Center and only news items count here. |
| [Fox News](https://www.allsides.com/news-source/fox-news-media-bias) | Right | Right | **Yes.** The online news desk is rated separately from opinion and TV programming, which are generally rated further right. |
| [National Review (News)](https://www.allsides.com/news-source/national-review-news-media-bias) | Right | Lean Right | — (opinion section rated Right, separately) |
| [Washington Examiner](https://www.allsides.com/news-source/washington-examiner-media-bias) | Right | Lean Right | — |
| [The Dispatch](https://www.allsides.com/news-source/dispatch-media-bias) | Right | Lean Right | — |

A "contested" flag does not mean we think the rating is wrong. It means the
rating is disputed — by the outlet, by the two rating organizations
disagreeing, or by a genuinely borderline score — and you deserve to know
that before trusting the group assignment.

## What this measures — and what it doesn't

Be clear-eyed about what the threshold is. It is a measurement of **editorial
attention**, not a measurement of truth.

**What clearing the threshold means:** at least four newsrooms, spanning
left, center, and right, independently decided within two days that an event
was worth covering. That convergence is meaningful — it filters out stories
that exist only inside one side's media ecosystem — but it is all the
threshold claims.

**What it does not mean:** that the story is true, accurate, important, or
fairly framed by any given outlet. Newsrooms across the spectrum can all
cover something that turns out to be wrong. They can all chase the same
manufactured controversy. A staged event designed to attract coverage can
attract coverage. The threshold cannot detect any of that, and we don't claim
it can. Read the sources — every card links to them.

**A story's absence is not a judgment.** If a story is not on GenPop, that
means one thing only: it has not (yet) been covered by four of these twelve
outlets across the spectrum within the window. It does not mean the story is
false, unimportant, or suppressed. Some true and consequential stories are
covered heavily by one part of the spectrum and ignored by another for days
or entirely; the rule excludes those by design, and the cost of that design
is real. An exclusive investigation that competitors don't match within 48
hours will not appear, however significant. We chose a rule that will
sometimes be silent about real stories over a rule that requires someone
here to decide what you should see. You should weigh that trade-off yourself.

The feed is also limited to civic and policy topics. Stories outside that
scope — sports, entertainment, business gossip — do not become cards even if
they clear the threshold.

## Versions and changes

Every parameter above is versioned, and every live card permanently records
the versions it was created under — the rule version, the outlet-list
version, and the clustering method — so you can always tell which rules
produced which card, including cards created before a change.

Our commitments:

- **All changes are logged here.** Any change to the outlet list, the
  threshold number, the window, the grouping of any outlet, or the matching
  method gets a dated entry in the change log below, with the reason. No
  silent edits.
- **Ratings are re-checked quarterly** against the current AllSides chart. If
  AllSides moves an outlet across a group boundary, our list follows —
  mechanically, whether or not the move is convenient for our balance — and
  the change is logged.
- **Old cards are never rewritten.** A card's audit trail — which outlets,
  which articles, when it cleared — is immutable once written.

Current versions: rule `1.0` · outlet list `2026-07-06` · matching
`token-overlap-1`.

### Change log

| Date | Change | Reason |
|---|---|---|
| 2026-07-06 | Initial list published (12 outlets, 4/4/4). AP grouped left-of-center per AllSides' May 2026 review. The Guardian not included (AllSides rates it Left — the outermost category — and BBC already provides a non-US vantage). The Dispatch and Washington Examiner included to bring the right-of-center group to parity. | Launch. |

## Questions this page should answer, honestly

**Why these 12 and not others?** We needed enough outlets for the threshold
to be meaningful, few enough to keep the list legible, balance across
AllSides categories, working public feeds, and substantial original news
desks. Reasonable people could build a different list; this one is published,
sourced, and versioned so you can hold us to it.

**Why AllSides as the primary source?** Because using a single, named,
third-party source with a public methodology is more defensible than blending
sources with our own judgment — blending is where hidden editorial choices
hide. Where AllSides is disputed, we say so rather than pick a rating we
like better.

**Why 4 outlets and not 3?** Three is the minimum that could span the
spectrum — exactly one outlet per group — which would make the gate only as
strong as its single weakest member in each group. Four requires at least one
redundant, independent editorial decision.

**Can the threshold be gamed?** Partially, yes, and we would rather say so
than pretend otherwise. The wire-service rule blocks the cheapest attack
(one story republished many times). What no rule can block is the media
itself converging on a manufactured story — the threshold measures the
press, and inherits the press's failure modes. The audit trail on every card
exists so you can judge the coverage yourself.
