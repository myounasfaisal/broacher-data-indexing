"""
The semantic index (P3) — one embedding per canonical chemical.

WHAT THIS IS FOR, AND WHAT IT IS NOT. It answers exactly one question keyword
search cannot: "find me chemicals LIKE this one". It is never a retrieval path
for facts — no price, supplier or CAS ever comes out of here. The vector store
holds identities; `search_listings` still owns the truth, and the neighbours
this returns are resolved back to live listing rows before anything is shown.
See docs/AI_SEARCH_ARCHITECTURE.md §1b and §2.

ONE ROW PER CHEMICAL, NOT PER LISTING. The same substance appears under many
suppliers; embedding each listing would multiply cost and make a similarity
search return twelve copies of one product.

PROVIDER: Anthropic has no embeddings API. Qwen's `text-embedding-v3` runs on
the DashScope OpenAI-compatible endpoint the extractor already uses — same key,
same base URL, no new account.

DETERMINISM MATTERS HERE. `build_source_text` sorts everything it composes,
because the stored text doubles as the change detector: if it varied run to
run, every refresh would re-embed the entire catalog.
"""

from __future__ import annotations

import logging
from typing import Any, Iterable

from openai import OpenAI

from app.config import eff_bool, eff_float, eff_int, eff_str, settings
from app.services import database, llm_clients

logger = logging.getLogger(__name__)


class EmbeddingError(Exception):
    """The embedding provider failed. Callers degrade; they do not 500."""


class EmbeddingsDisabled(EmbeddingError):
    """EMBEDDINGS_ENABLED is off for this deployment."""


# Cap on one chemical's source text. Well past the useful signal — beyond a few
# hundred characters the extra `details` prose stops distinguishing substances
# and starts pulling every neighbour toward a generic "industrial chemical"
# centroid.
_MAX_SOURCE_CHARS = 1200

# Details keys that carry no identity signal. Embedding them makes two
# unrelated substances look alike purely because both ship in 25kg bags.
_NOISE_KEYS = frozenset(
    {
        "packaging",
        "package",
        "packing",
        "moq",
        "min_order",
        "minimum_order",
        "price",
        "currency",
        "delivery",
        "lead_time",
        "payment_terms",
        "origin",
        "brand",
        # PubChem enrichment: authoritative, but not from the brochure and not
        # what a sourcing question is phrased in.
        "reference_data",
    }
)

def _get_client() -> OpenAI:
    """The provider is re-read per call, so switching Qwen -> OpenAI in
    Settings takes effect on the next batch rather than at the next restart."""
    if eff_str("embedding_provider") == "openai":
        return llm_clients.openai_client()
    return llm_clients.qwen_client()


def enabled() -> bool:
    return eff_bool("embeddings_enabled")


def index_size() -> int:
    """
    How many chemicals are indexed.

    Zero with the feature ON means the migration ran but the backfill did not —
    an operational gap, and NOT the same answer as "nothing is similar". The
    tool layer reports the two differently.
    """
    try:
        return database.count_chemical_embeddings()
    except Exception as exc:  # noqa: BLE001 — an unreachable index degrades
        logger.warning("Could not size the embedding index: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Source text
# ---------------------------------------------------------------------------


def _detail_fragments(details: Any) -> list[str]:
    """Identity-bearing values out of one listing's free-form details blob."""
    if not isinstance(details, dict):
        return []
    out: list[str] = []
    for key, value in details.items():
        if key in _NOISE_KEYS:
            continue
        if isinstance(value, str):
            text = value.strip()
        elif isinstance(value, (int, float, bool)):
            text = str(value)
        elif isinstance(value, list):
            text = ", ".join(str(v).strip() for v in value if v)
        else:
            # Nested objects are almost always reference blocks or per-grade
            # tables; their keys are structure, not vocabulary.
            continue
        if text:
            # The KEY is kept as well as the value: "application: tile
            # adhesive" carries the application language that a sourcing
            # question is actually phrased in.
            out.append(f"{key.replace('_', ' ')}: {text}")
    return out


def build_source_text(
    chemical: dict[str, Any], listings: Iterable[dict[str, Any]]
) -> str:
    """
    Compose what gets embedded for one chemical: canonical name, the trade
    names suppliers actually printed, the CAS, and the technical/application
    vocabulary from the listings' details.

    Sorted and de-duplicated throughout — see the module docstring on why
    determinism is load-bearing.
    """
    parts: list[str] = []
    name = (chemical.get("name_en") or "").strip()
    if name:
        parts.append(name)
    cas = (chemical.get("cas_number") or "").strip()
    if cas:
        parts.append(f"CAS {cas}")

    trade_names: set[str] = set()
    fragments: set[str] = set()
    for listing in listings:
        for key in ("name_en", "name_raw"):
            value = (listing.get(key) or "").strip()
            if value and value.lower() != name.lower():
                trade_names.add(value)
        fragments.update(_detail_fragments(listing.get("details")))

    parts.extend(sorted(trade_names))
    parts.extend(sorted(fragments))

    text = " | ".join(parts)
    return text[:_MAX_SOURCE_CHARS].strip()


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Embed a list of texts, batched to the provider's per-call input limit.

    Raises EmbeddingError on any provider failure — every caller treats that as
    "degrade", never as "fail the user's request".
    """
    if not enabled():
        raise EmbeddingsDisabled()
    if not texts:
        return []

    client = _get_client()
    out: list[list[float]] = []
    size = max(1, settings.embedding_batch_size)
    for start in range(0, len(texts), size):
        batch = texts[start : start + size]
        try:
            resp = client.embeddings.create(
                model=eff_str("embedding_model"),
                input=batch,
                dimensions=eff_int("embedding_dim"),
            )
        except Exception as exc:  # noqa: BLE001 — normalised for the callers
            raise EmbeddingError(f"embedding request failed: {exc}") from exc

        # The API is documented to return items in input order, but it also
        # carries an explicit index — trust the index. A silent off-by-one here
        # would attach every chemical's vector to its neighbour, which no test
        # short of a similarity spot-check would catch.
        ordered = sorted(resp.data, key=lambda d: d.index)
        for item in ordered:
            vector = list(item.embedding)
            if len(vector) != eff_int("embedding_dim"):
                raise EmbeddingError(
                    f"provider returned {len(vector)} dimensions, "
                    f"expected {eff_int('embedding_dim')}"
                )
            out.append(vector)

    if len(out) != len(texts):
        raise EmbeddingError(
            f"provider returned {len(out)} embeddings for {len(texts)} inputs"
        )
    return out


def embed_query(text: str) -> list[float]:
    """One embedding for a search phrase."""
    vectors = embed_texts([text.strip()])
    if not vectors:
        raise EmbeddingError("empty embedding response")
    return vectors[0]


# ---------------------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------------------


def refresh_chemicals(
    chemical_ids: list[str], *, force: bool = False
) -> dict[str, int]:
    """
    Re-embed the given chemicals, skipping any whose source text is unchanged.

    Returns counts: {"considered", "embedded", "skipped"}. Never raises for a
    provider failure — indexing is a background nicety and must not take a
    finished upload down with it.
    """
    if not enabled():
        return {"considered": 0, "embedded": 0, "skipped": 0}

    ids = [i for i in dict.fromkeys(chemical_ids) if i]
    if not ids:
        return {"considered": 0, "embedded": 0, "skipped": 0}

    chemicals = database.get_chemicals_by_ids(ids)
    listings_by_chemical: dict[str, list[dict[str, Any]]] = {}
    for row in database.listings_for_chemicals(ids):
        listings_by_chemical.setdefault(str(row.get("chemical_id")), []).append(row)

    existing = {} if force else database.get_embedding_source_texts(ids)

    pending_ids: list[str] = []
    pending_texts: list[str] = []
    skipped = 0
    for chemical_id in ids:
        chemical = chemicals.get(chemical_id)
        if not chemical:
            continue

        listings = listings_by_chemical.get(chemical_id, [])
        if not listings:
            # NOT INDEXED: a chemical with no listing cannot be bought, and an
            # alternative we cannot buy is trivia (§5). This is not a rare
            # edge case — two thirds of the `chemicals` rows in the live
            # catalog are identities created by CAS lookup that no brochure
            # ever priced. Indexing them would let unbuyable rows fill the
            # top-N of every similarity search, and they would then be dropped
            # downstream, so the user would see fewer real alternatives the
            # BIGGER the index got.
            #
            # Self-correcting: the worker refreshes whatever a completed
            # upload touched, so a chemical gains its embedding the moment a
            # brochure actually lists it.
            skipped += 1
            continue

        text = build_source_text(chemical, listings)
        if not text:
            continue
        if existing.get(chemical_id) == text:
            skipped += 1
            continue
        pending_ids.append(chemical_id)
        pending_texts.append(text)

    if not pending_ids:
        return {"considered": len(ids), "embedded": 0, "skipped": skipped}

    try:
        vectors = embed_texts(pending_texts)
    except EmbeddingError as exc:
        logger.warning("Embedding refresh failed for %d chemicals: %s",
                       len(pending_ids), exc)
        return {"considered": len(ids), "embedded": 0, "skipped": skipped}

    rows = [
        {"chemical_id": cid, "embedding": vec, "source_text": text}
        for cid, vec, text in zip(pending_ids, vectors, pending_texts)
    ]
    try:
        written = database.upsert_chemical_embeddings(rows)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Embedding upsert failed: %s", exc)
        return {"considered": len(ids), "embedded": 0, "skipped": skipped}

    return {"considered": len(ids), "embedded": written, "skipped": skipped}


def refresh_document(document_id: str) -> dict[str, int]:
    """
    Re-embed the chemicals one finished document touched.

    Called from the worker after a document completes: only what the upload
    changed is re-embedded, so a finished brochure costs a handful of calls
    rather than a full re-index.
    """
    if not enabled():
        return {"considered": 0, "embedded": 0, "skipped": 0}
    try:
        ids = database.chemical_ids_for_document(document_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not list chemicals for document %s: %s",
                       document_id, exc)
        return {"considered": 0, "embedded": 0, "skipped": 0}
    return refresh_chemicals(ids)


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------


def similar_chemicals(
    text: str,
    *,
    limit: int | None = None,
    exclude_chemical_id: str | None = None,
) -> list[dict[str, Any]]:
    """
    Chemicals whose indexed identity is closest to `text`.

    Each row: {chemical_id, name_en, cas_number, similarity}. Raises
    EmbeddingError when the provider or the index is unreachable, so the caller
    can say "similarity search is unavailable" rather than "nothing is
    similar" — those are different answers and conflating them is how an
    outage becomes a false negative on availability.
    """
    vector = embed_query(text)
    try:
        return database.match_chemicals(
            vector,
            limit=limit or eff_int("embedding_match_count"),
            exclude_chemical_id=exclude_chemical_id,
            min_similarity=eff_float("embedding_min_similarity"),
        )
    except Exception as exc:  # noqa: BLE001
        raise EmbeddingError(f"similarity search failed: {exc}") from exc
