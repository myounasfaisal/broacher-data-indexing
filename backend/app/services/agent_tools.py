"""
Tool registry for the chat assistant — provider-neutral.

Every tool is declared ONCE here (name, description, JSON-Schema parameters,
executor) and rendered into whichever wire format the active provider wants:
Anthropic's `input_schema` shape or OpenAI's `function.parameters` shape.
Adding a tool means adding one entry, not touching two provider loops.

CRITICAL DESIGN RULE (inherited from nl_search.py, and stronger here because
the model now writes prose): the model never produces chemical data. Every row
it talks about comes from one of these executors, which are thin wrappers over
the same `database.py` functions the manual filter search uses. The model
chooses WHICH query to run and explains the result; it never supplies the
result.

Tool descriptions are deliberately prescriptive about WHEN to call — recent
models under-reach for tools when given purely descriptive text ("returns
listings") instead of a trigger condition ("call this when the user names a
specific product").
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable

from app.config import settings
from app.services import database, embeddings

logger = logging.getLogger(__name__)


class ToolError(Exception):
    """A tool executor failed. Surfaced to the model, not to the user."""


# ---------------------------------------------------------------------------
# Executors
# ---------------------------------------------------------------------------


def _truncate(rows: list[dict[str, Any]], total: int) -> dict[str, Any]:
    """
    Standard envelope. `truncated` matters: without it the model cannot tell
    "these are all 3 suppliers" from "these are 40 of 200", and will state the
    former when only the latter is true.
    """
    return {"rows": rows, "returned": len(rows), "total": total,
            "truncated": total > len(rows)}


def _query_variants(query: str) -> list[str]:
    """
    Progressively broader forms of a phrase query, best first.

    `search_listings` matches with a substring ilike against `search_text`, so
    a multi-word phrase only hits when it appears VERBATIM. "hydrocarbon
    resins" therefore misses "Hydrocarbon Resin C5&C9" — on the plural `s`
    alone — and the catalog reports nothing while holding 25 matches.

    Both models tested fell into this identically, which is what makes it a
    retrieval bug rather than a prompting one: instructing a model to "use
    short terms" is asking it to work around a search that cannot match the
    phrase a human would naturally type.

    Order: the phrase as given, then singularised, then each individual word
    (singularised). Single words are returned for the CALLER to try and score
    — see _search_catalog, which picks the rarest match rather than the first,
    because the rarest term is the most informative one. For "floor coatings",
    "floor" (1 hit) says far more about the user's intent than "coatings"
    (8 hits), and simply taking the longest word would have chosen the latter.
    """
    query = query.strip()
    variants: list[str] = [query]

    def singular(word: str) -> str:
        # Deliberately crude: English plural 's' only. "es"/"ies" stemming
        # would start mangling chemical names, which is a worse failure.
        return word[:-1] if len(word) > 3 and word.lower().endswith("s") else word

    words = query.split()
    if len(words) > 1:
        variants.append(" ".join(singular(w) for w in words))
        # Longest first only as a tiebreak; the caller scores these by rarity.
        for word in sorted(words, key=len, reverse=True):
            if len(word) > 2:
                variants.append(singular(word))
    else:
        variants.append(singular(query))

    seen: set[str] = set()
    out: list[str] = []
    for v in variants:
        key = v.lower()
        if v and key not in seen:
            seen.add(key)
            out.append(v)
    return out


def _search_catalog(
    query: str | None = None,
    supplier: str | None = None,
    cas_number: str | None = None,
    details_query: str | None = None,
) -> dict[str, Any]:
    # NOTE: `priced_only` is deliberately NOT exposed to the model.
    #
    # Most listings have no printed price, so the filter removes ~everything —
    # and in testing the model set it unprompted (despite an explicit
    # instruction not to), turning "we stock one flooring admixture" into "the
    # catalog has nothing for floor coatings". A silent false negative on
    # availability is the worst answer this assistant can give, and no prompt
    # wording reliably stopped it. The manual filter UI still offers it, where
    # the user chooses it knowingly and can see it is on.
    def run(q: str | None) -> tuple[list[dict[str, Any]], int]:
        return database.search_listings(
            q=q,
            supplier=supplier,
            cas_number=cas_number,
            details_query=details_query,
            # Name order, not price order. Price ordering would rank the
            # catalog by which supplier happened to print a number — see
            # _completeness_rank.
            sort="name_asc",
            page=1,
            page_size=settings.chat_max_rows,
            columns=database.AGENT_COLUMNS,
        )

    if not query:
        rows, total = run(None)
        return _truncate(rows, total)

    # Widen automatically rather than returning a false "nothing found".
    used = query
    rows, total = run(query)
    if not rows:
        variants = _query_variants(query)[1:]
        best: tuple[list[dict[str, Any]], int, str] | None = None
        for variant in variants:
            candidate_rows, candidate_total = run(variant)
            if not candidate_rows:
                continue
            # Prefer the RAREST non-empty match: a term matching 1 product is
            # a far better reading of the question than one matching 40.
            # Whole-phrase variants (with a space) win ties, being closest to
            # what was actually asked.
            if best is None or candidate_total < best[1]:
                best = (candidate_rows, candidate_total, variant)
            if " " in variant:
                break
        if best is not None:
            rows, total, used = best

    if used != query and " " in query and " " not in used:
        # A DROPPED WORD CHANGES THE SUBSTANCE. 'calcium carbonate' widened to
        # 'carbonate' matches dimethyl carbonate — a different chemical.
        #
        # Withhold those rows entirely rather than returning them with a
        # warning attached. Three prompt revisions tried to teach the model to
        # discount them and each produced a new confusion, ending in "we stock
        # zinc oxide and calcium carbonate, but neither is in the catalog".
        # It cannot reliably hold "here are rows, now treat them as no rows".
        # An empty result is unambiguous, and the broader term is offered as a
        # lead the model can choose to follow.
        #
        # But withholding them outright caused the opposite failure: asked
        # "what do we stock for floor coatings?", the model saw zero and said
        # we stock nothing, while we do hold a flooring admixture. No lexical
        # rule separates "calcium carbonate" (one substance) from "floor
        # coatings" (two application words) — that is the semantic-search
        # problem, and it is what P3's find_similar_chemicals now answers.
        #
        # This heuristic STAYS anyway. It is deterministic and free, it works
        # with the index off or unbuilt, and it fixes the plural/singular case
        # ("hydrocarbon resins") that a vector search would answer more
        # expensively and less exactly. The note below routes the genuinely
        # semantic case onward.
        #
        # Keep the PRIMARY result unambiguous at zero, and hand the widened
        # hits back in a separate field the model must describe differently.
        # They stay citable, so nothing is hidden from the user.
        return {
            "rows": [],
            "returned": 0,
            "total": 0,
            "truncated": False,
            "related_rows": rows,
            "note": (
                f"No product matches '{query}'. `related_rows` holds "
                f"{total} product(s) matching only the broader term '{used}'. "
                f"They are NOT '{query}' and may be entirely different "
                f"substances. If one genuinely suits the user's need, offer it "
                f"as a near-miss and say plainly what it is; otherwise say we "
                f"hold nothing for '{query}'. If '{query}' described a JOB "
                f"rather than a substance, call find_similar_chemicals with it "
                f"before concluding anything — a name search cannot match a "
                f"product the brochure worded differently."
            ),
        }

    payload = _truncate(rows, total)
    if used != query:
        # Same phrase, just singularised — genuinely the same thing.
        payload["matched_query"] = used
        payload["note"] = (
            f"No exact match for '{query}'; these are results for '{used}'."
        )
    return payload


def _compare_suppliers(
    cas_number: str | None = None,
    chemical_id: str | None = None,
) -> dict[str, Any]:
    rows = database.compare_suppliers(
        cas_number=cas_number,
        chemical_id=chemical_id,
        limit=settings.chat_max_rows,
    )
    return _truncate(rows, len(rows))


def _list_detail_keys() -> dict[str, Any]:
    keys = database.list_detail_keys()
    return {"keys": keys, "returned": len(keys)}


# Listings surfaced per neighbouring chemical. Enough to show the substance is
# genuinely buyable from more than one place, few enough that eight neighbours
# don't blow the row budget.
_LISTINGS_PER_NEIGHBOUR = 3


def _find_similar_chemicals(
    description: str | None = None,
    chemical_name: str | None = None,
    chemical_id: str | None = None,
) -> dict[str, Any]:
    """
    Functional neighbours, constrained to what is actually in the catalog.

    The ONE job keyword search cannot do (§2). Two failure modes are handled
    explicitly rather than collapsed into an empty result:

      * index unavailable (feature off, never backfilled, provider down) →
        degrade to a name search and SAY SO. "Similarity is unavailable" and
        "nothing is similar" are different answers, and serving the second
        when the first is true is a false negative on availability — the worst
        answer this assistant gives (§14.3).
      * a neighbour we cannot buy → dropped. An alternative with no listing is
        trivia (§5).
    """
    query = (description or chemical_name or "").strip()
    if not query:
        return {"error": "Pass `description` or `chemical_name`."}

    # A chemical is not an alternative to itself: same substance, different
    # supplier is a sourcing question, and compare_suppliers owns it.
    exclude_id = chemical_id
    if not exclude_id and chemical_name:
        matches = database.find_chemicals_by_name(chemical_name, limit=1)
        if matches:
            exclude_id = matches[0]["id"]

    degraded_reason: str | None = None
    if not embeddings.enabled():
        degraded_reason = "semantic search is not enabled on this deployment"
    elif embeddings.index_size() == 0:
        degraded_reason = "the semantic index has not been built yet"

    neighbours: list[dict[str, Any]] = []
    if degraded_reason is None:
        try:
            neighbours = embeddings.similar_chemicals(
                query, exclude_chemical_id=exclude_id
            )
        except embeddings.EmbeddingError as exc:
            logger.warning("Similarity search degraded: %s", exc)
            degraded_reason = "the semantic index is temporarily unavailable"

    if degraded_reason is not None:
        fallback = _search_catalog(query=query)
        fallback["degraded"] = True
        fallback["note"] = (
            f"SIMILARITY SEARCH DEGRADED — {degraded_reason}. These rows are a "
            f"NAME match on '{query}', not functional neighbours: they may "
            "share a word without doing the same job, and a substance that "
            "does the job under a different name is missing entirely. Do not "
            "present them as alternatives without checking each row's own "
            "details, and do not conclude from this that we hold nothing."
            + ("  " + str(fallback["note"]) if fallback.get("note") else "")
        )
        return fallback

    rows: list[dict[str, Any]] = []
    dropped_unbuyable = 0
    for neighbour in neighbours:
        listings = database.compare_suppliers(
            chemical_id=neighbour["chemical_id"], limit=_LISTINGS_PER_NEIGHBOUR
        )
        if not listings:
            # Indexed but no live listing — deleted since, or the chemical row
            # outlived its brochure. Not purchasable, so not an alternative.
            dropped_unbuyable += 1
            continue
        for listing in listings:
            rows.append(
                {
                    **listing,
                    # Attached per row so the model cannot mix up which
                    # similarity belongs to which substance.
                    "similarity": round(float(neighbour.get("similarity") or 0), 3),
                    "similar_to_query": query,
                }
            )
        if len(rows) >= settings.chat_max_rows:
            break

    rows = rows[: settings.chat_max_rows]

    # §5 ranking: house knowledge outranks a semantic neighbour, so point the
    # model at it rather than letting a similarity score look authoritative.
    has_house_notes = False
    if exclude_id:
        try:
            has_house_notes = bool(database.list_substitution_notes([exclude_id]))
        except Exception as exc:  # noqa: BLE001 — a hint, never load-bearing
            logger.warning("House-note check failed during similarity: %s", exc)

    note = (
        "These are FUNCTIONAL NEIGHBOURS by semantic similarity, not verified "
        "substitutes. Similarity means the catalog describes them in similar "
        "language — it does NOT mean one does the other's job. Apply the same "
        "evidence test as any other candidate: quote words in the row's own "
        "details showing it IS the thing. Confidence here never exceeds "
        "medium.\n"
        # MEASURED on the live catalog (2026-07-26, 324 indexed chemicals):
        # every query scores in a 0.55-0.66 band, INCLUDING ones the catalog
        # cannot serve at all — "food-grade gelatin" returned a full slate at
        # 0.55-0.60 while a genuine epoxy-hardener match sat at 0.62. So the
        # score does not separate a hit from a miss, and no threshold makes it.
        # The model must be told that explicitly, or it will read the ranking
        # as a verdict — the §14.5 failure where a confident number makes a
        # wrong answer MORE persuasive.
        "IMPORTANT: this tool ALWAYS returns its closest rows, even when "
        "nothing suitable exists. Scores here cluster in a narrow band, so a "
        "high-looking number is not evidence of a match and the ranking is not "
        "a verdict. Rejecting every row is a normal, correct outcome — if none "
        "passes the evidence test, say we hold nothing for this."
    )
    if has_house_notes:
        note += (
            " A house substitution note exists for this substance — call "
            "lookup_substitution_notes and lead with that instead; it "
            "outranks anything here."
        )
    if dropped_unbuyable:
        note += (
            f" {dropped_unbuyable} similar substance(s) were dropped for "
            "having no current listing."
        )
    if not rows:
        note += (
            " Nothing similar is stocked. That is a real answer — say so "
            "plainly rather than offering an unrelated product."
        )

    return {
        "rows": rows,
        "returned": len(rows),
        "total": len(rows),
        "truncated": False,
        "degraded": False,
        "note": note,
    }


def _resolve_chemicals(
    chemical_id: str | None, chemical_name: str | None
) -> list[str]:
    """
    Turn whatever the model has into canonical chemical ids.

    It usually has a name (the user typed one) and sometimes an id (from a
    listing row it already fetched). A name can match a small family — 'epoxy
    resin' and 'epoxy resin hardener' — and notes on any of them are relevant,
    so this returns a list rather than picking one.
    """
    if chemical_id:
        return [chemical_id]
    if not chemical_name:
        return []
    return [c["id"] for c in database.find_chemicals_by_name(chemical_name)]


def _authors(rows: list[dict[str, Any]]) -> None:
    """
    Attach author emails in place.

    House knowledge is only worth overriding the model with if the answer can
    say WHO decided it — an unattributed note is just another confident claim.
    Best-effort: a failed lookup drops the name, never the note.
    """
    ids = {str(r["author_id"]) for r in rows if r.get("author_id")}
    if not ids:
        return
    try:
        emails = database.get_user_emails(ids)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Author lookup failed for house notes: %s", exc)
        return
    for row in rows:
        row["author"] = emails.get(str(row.get("author_id") or ""))


# Every house-knowledge result carries this. The precedence rule is repeated
# at the point of use rather than left to the system prompt alone, because in
# testing prompt-level rules degraded whenever a later instruction competed
# with them — a rule attached to the data it governs does not.
_HOUSE_PRECEDENCE = (
    "These are BosTech's OWN recorded decisions. They OVERRIDE your general "
    "chemistry knowledge. Attribute them in your answer ('house note from "
    "<author>') and repeat the context they were written for — a substitution "
    "is only valid in its context."
)


def _lookup_substitution_notes(
    chemical_name: str | None = None,
    chemical_id: str | None = None,
) -> dict[str, Any]:
    ids = _resolve_chemicals(chemical_id, chemical_name)
    if not ids:
        return {
            "rows": [],
            "returned": 0,
            "note": (
                f"No canonical chemical matches '{chemical_name}', so there can "
                "be no house notes on it. This says NOTHING about whether the "
                "catalog stocks it — use search_catalog for that."
            ),
        }

    rows = database.list_substitution_notes(ids)
    _authors(rows)
    out = [
        {
            "from": r.get("from_name"),
            "to": r.get("to_name"),
            # 'avoid' means we TRIED this and it did not work. Surfaced as a
            # first-class field so a warning can never be read as a
            # recommendation.
            "verdict": r.get("verdict"),
            "context": r.get("context"),
            "to_in_catalog": bool(r.get("to_chemical_id")),
            "author": r.get("author"),
            "recorded": str(r.get("created_at") or "")[:10],
        }
        for r in rows
    ]
    if not out:
        return {
            "rows": [],
            "returned": 0,
            "note": (
                "No house notes recorded for this substance. Fall back to your "
                "own chemistry knowledge, and say that is what you are doing."
            ),
        }
    return {"rows": out, "returned": len(out), "note": _HOUSE_PRECEDENCE}


def _lookup_regulatory_notes(
    chemical_name: str | None = None,
    chemical_id: str | None = None,
) -> dict[str, Any]:
    ids = _resolve_chemicals(chemical_id, chemical_name)
    rows = database.list_regulatory_notes(ids) if ids else []
    _authors(rows)
    out = [
        {
            "chemical": r.get("chemical_name"),
            # Jurisdiction and date are never optional in the output: a status
            # without a where and a when is the flattened claim §6.3 exists to
            # prevent.
            "jurisdiction": r.get("jurisdiction"),
            "status": r.get("status"),
            "effective_date": r.get("effective_date"),
            "note": r.get("note"),
            "source_url": r.get("source_url"),
            "author": r.get("author"),
            "recorded": str(r.get("created_at") or "")[:10],
        }
        for r in rows
    ]
    if not out:
        return {
            "rows": [],
            "returned": 0,
            "note": (
                "Nothing recorded. You have NO regulatory source for this "
                "substance — do not state or imply a status from your own "
                "knowledge. Say it is not recorded and needs a current "
                "regulatory source. If the user asserted a ban, accept their "
                "premise and answer the sourcing question instead."
            ),
        }
    return {
        "rows": out,
        "returned": len(out),
        "note": (
            "House-recorded regulatory status. State the jurisdiction and the "
            "date with it, never the status alone, and attribute it. It covers "
            "ONLY the jurisdictions listed here."
        ),
    }


def _get_listing_provenance(listing_id: str) -> dict[str, Any]:
    found = database.get_listing_provenance(listing_id)
    if not found:
        return {"found": False, "listing_id": listing_id}
    return {"found": True, **found}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class Tool:
    def __init__(
        self,
        name: str,
        description: str,
        parameters: dict[str, Any],
        executor: Callable[..., dict[str, Any]],
    ) -> None:
        self.name = name
        self.description = description
        self.parameters = parameters
        self.executor = executor


TOOLS: list[Tool] = [
    Tool(
        name="search_catalog",
        description=(
            "Search the supplier catalog. CALL THIS FIRST for any question "
            "about what we can source, what a supplier carries, or which "
            "products suit a described requirement — including when the user "
            "asks for a substitute or alternative, because any alternative "
            "you suggest must actually exist in this catalog.\n"
            "Use `query` for a chemical or trade name, `details_query` for a "
            "technical or application requirement (e.g. 'tile adhesive', "
            "'flooring', 'hardener'), and `supplier` to restrict to one "
            "company. Combine `query` and `supplier` to ask 'this product, "
            "from this supplier'.\n"
            "Returned rows include a `details` object holding whatever "
            "technical attributes the brochure printed — this is the main "
            "thing to reason about, since most listings have no price."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Chemical name, trade name, or CAS. Also matches text "
                        "inside a product's details and its supplier's name."
                    ),
                },
                "supplier": {
                    "type": "string",
                    "description": "Restrict to suppliers whose name contains this.",
                },
                "cas_number": {
                    "type": "string",
                    "description": "CAS number substring.",
                },
                "details_query": {
                    "type": "string",
                    "description": (
                        "Short free-text keyword matched against the flexible "
                        "per-product details (application, grade, packaging, "
                        "appearance...). Use a single keyword or short phrase; "
                        "do not pass a JSON key name."
                    ),
                },
            },
            "required": [],
        },
        executor=_search_catalog,
    ),
    Tool(
        name="compare_suppliers",
        description=(
            "List every supplier that carries ONE specific substance, "
            "identified by exact CAS number or chemical_id. Call this when the "
            "user names a specific product and wants to know who supplies it, "
            "or after search_catalog has pinned down which substance they "
            "mean. Results are ordered by how complete each supplier's data "
            "is, not by price."
        ),
        parameters={
            "type": "object",
            "properties": {
                "cas_number": {
                    "type": "string",
                    "description": "Exact CAS number, e.g. '1310-73-2'.",
                },
                "chemical_id": {
                    "type": "string",
                    "description": (
                        "Canonical chemical id, taken from a listing's "
                        "chemical_id field. Prefer this over CAS when known."
                    ),
                },
            },
            "required": [],
        },
        executor=_compare_suppliers,
    ),
    Tool(
        name="find_similar_chemicals",
        description=(
            "Find products that are FUNCTIONALLY similar to a substance or to "
            "a described requirement, by meaning rather than by wording. CALL "
            "THIS when a keyword search came back empty or thin and the user "
            "described a JOB rather than naming a product ('something for "
            "floor coatings', 'a white opacifying pigment') — a name search "
            "misses anything the brochures worded differently.\n"
            "Also call it after lookup_substitution_notes when no house note "
            "exists, to see what near-equivalents we actually stock.\n"
            "Each row carries a `similarity` score and is a real catalog "
            "listing you may cite. Similar wording is NOT proof of "
            "equivalence: check each row's own details before offering it, "
            "and never rate a match from here above medium confidence."
        ),
        parameters={
            "type": "object",
            "properties": {
                "description": {
                    "type": "string",
                    "description": (
                        "What the product needs to DO, in the user's own "
                        "terms, e.g. 'hardener for tile adhesive' or 'white "
                        "opacifying pigment for coatings'."
                    ),
                },
                "chemical_name": {
                    "type": "string",
                    "description": (
                        "Find substances like this one. The named substance "
                        "itself is excluded from the results — it is not an "
                        "alternative to itself."
                    ),
                },
                "chemical_id": {
                    "type": "string",
                    "description": (
                        "Canonical chemical id to exclude, when you already "
                        "have it from a listing row."
                    ),
                },
            },
            "required": [],
        },
        executor=_find_similar_chemicals,
    ),
    Tool(
        name="lookup_substitution_notes",
        description=(
            "Look up BosTech's OWN recorded substitution decisions for a "
            "substance — what the team has actually used in place of what, and "
            "in which application. CALL THIS FIRST, BEFORE search_catalog, "
            "whenever the user asks what can replace something, what an "
            "alternative is, or what to use instead. These notes were written "
            "by BosTech's managers and OVERRIDE your own chemistry judgement; "
            "answering from general knowledge when a house note exists is "
            "wrong even if the chemistry is sound.\n"
            "A note may carry verdict 'avoid', meaning the team tried that "
            "swap and it did NOT work. Never present those as options.\n"
            "An empty result means nothing is recorded — then use your own "
            "chemistry and say so."
        ),
        parameters={
            "type": "object",
            "properties": {
                "chemical_name": {
                    "type": "string",
                    "description": (
                        "The substance the user wants to replace, e.g. "
                        "'titanium dioxide'. Use the plain chemical name."
                    ),
                },
                "chemical_id": {
                    "type": "string",
                    "description": (
                        "Canonical chemical id from a listing's chemical_id "
                        "field. Prefer this when you already have it."
                    ),
                },
            },
            "required": [],
        },
        executor=_lookup_substitution_notes,
    ),
    Tool(
        name="lookup_regulatory_notes",
        description=(
            "Look up BosTech's recorded regulatory status for a substance — "
            "jurisdiction, status, effective date and the nuance around it. "
            "CALL THIS whenever a question touches bans, restrictions, "
            "compliance or REACH. This table is your ONLY regulatory source: "
            "if it returns nothing you have no basis for any statement about "
            "regulatory status, and must say so rather than answering from "
            "memory. Bans are jurisdiction-specific and dated, so always "
            "report the jurisdiction and date alongside the status."
        ),
        parameters={
            "type": "object",
            "properties": {
                "chemical_name": {
                    "type": "string",
                    "description": "The substance in question, plain name.",
                },
                "chemical_id": {
                    "type": "string",
                    "description": "Canonical chemical id, when you have it.",
                },
            },
            "required": [],
        },
        executor=_lookup_regulatory_notes,
    ),
    Tool(
        name="list_detail_keys",
        description=(
            "List the technical attribute names that actually appear in this "
            "catalog, with how common each is. Call this when you are unsure "
            "what vocabulary the brochures use for an attribute the user "
            "mentioned — different suppliers label the same concept "
            "differently ('application' vs 'uses' vs 'recommended_for'), so "
            "guessing a key name can silently match nothing."
        ),
        parameters={"type": "object", "properties": {}, "required": []},
        executor=_list_detail_keys,
    ),
    Tool(
        name="get_listing_provenance",
        description=(
            "Show which uploaded brochure and page a listing came from. Call "
            "this when the user questions where a figure came from or asks to "
            "verify a product."
        ),
        parameters={
            "type": "object",
            "properties": {
                "listing_id": {
                    "type": "string",
                    "description": "The listing's id field.",
                },
            },
            "required": ["listing_id"],
        },
        executor=_get_listing_provenance,
    ),
]

TOOLS_BY_NAME: dict[str, Tool] = {t.name: t for t in TOOLS}


# ---------------------------------------------------------------------------
# Wire formats
# ---------------------------------------------------------------------------


def anthropic_schema() -> list[dict[str, Any]]:
    """Tool definitions in Anthropic's Messages API shape."""
    return [
        {
            "name": t.name,
            "description": t.description,
            "input_schema": t.parameters,
        }
        for t in TOOLS
    ]


def openai_schema() -> list[dict[str, Any]]:
    """Tool definitions in the OpenAI/Qwen chat-completions shape."""
    return [
        {
            "type": "function",
            "function": {
                "name": t.name,
                "description": t.description,
                "parameters": t.parameters,
            },
        }
        for t in TOOLS
    ]


# ---------------------------------------------------------------------------
# Execution
# ---------------------------------------------------------------------------


class CallGuard:
    """
    Per-turn memory of which tool calls have already run.

    Models re-issue the identical search when the first one disappoints —
    observed in testing as `search_catalog('solvent')` five times in one turn,
    burning the iteration budget on a query whose answer had not changed.
    Telling the model it already ran that, rather than silently serving the
    same empty result again, pushes it to vary the query or conclude.

    One instance per run(); not shared across turns.
    """

    def __init__(self) -> None:
        self._seen: set[str] = set()

    def key(self, name: str, arguments: dict[str, Any]) -> str:
        return json.dumps([name, arguments], sort_keys=True, default=str)

    def seen(self, name: str, arguments: dict[str, Any]) -> bool:
        return self.key(name, arguments) in self._seen

    def record(self, name: str, arguments: dict[str, Any]) -> None:
        self._seen.add(self.key(name, arguments))


def execute(
    name: str,
    arguments: dict[str, Any],
    guard: "CallGuard | None" = None,
) -> dict[str, Any]:
    """
    Run one tool call. Never raises: a failure is returned to the model as an
    error payload so it can adapt (try a different query, tell the user it
    couldn't look something up) instead of the whole exchange 500-ing.
    """
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return {"error": f"Unknown tool '{name}'."}

    if not isinstance(arguments, dict):
        return {"error": "Tool arguments must be a JSON object."}

    # Drop keys the tool doesn't declare rather than raising TypeError — models
    # occasionally invent a plausible extra parameter.
    allowed = set(tool.parameters.get("properties", {}))
    cleaned = {k: v for k, v in arguments.items() if k in allowed}

    if guard is not None:
        if guard.seen(name, cleaned):
            return {
                # `duplicate` so the UI can say "already searched" rather than
                # "lookup failed" — a guard rejection is not a malfunction.
                "duplicate": True,
                "error": (
                    f"You already ran {name} with exactly these arguments this "
                    "turn and the result has not changed. Try a DIFFERENT "
                    "search term, a different tool, or answer with what you "
                    "have."
                ),
            }
        guard.record(name, cleaned)

    try:
        return tool.executor(**cleaned)
    except Exception as exc:  # noqa: BLE001 - reported to the model, not raised
        logger.warning("Chat tool %s failed: %s", name, exc)
        return {"error": f"{name} failed: {exc}"}


def collect_listing_ids(result: dict[str, Any]) -> set[str]:
    """
    Every listing id a tool result actually contained.

    This is the allowlist the agent validates the model's citations against —
    the mechanism that stops a hallucinated id from reaching the UI and being
    rendered as a real product row.
    """
    ids: set[str] = set()
    # `related_rows` are near-misses from a widened search. They are still
    # real database rows, so they stay citable — the model just has to
    # describe them honestly (see the note it receives alongside them).
    for key in ("rows", "related_rows"):
        for row in result.get(key) or []:
            if isinstance(row, dict) and row.get("id"):
                ids.add(str(row["id"]))
    if result.get("listing_id") and result.get("found"):
        ids.add(str(result["listing_id"]))
    return ids
