"""
One-off backfill for the semantic index (P3).

    python -m app.embed_backfill            # embed anything missing/changed
    python -m app.embed_backfill --force    # re-embed everything
    python -m app.embed_backfill --limit 50 # dry a small slice first

WHY THIS EXISTS SEPARATELY FROM THE WORKER: the worker only refreshes the
chemicals a finished document touched, which is right for steady state and
useless for the catalog that already exists. Run this once after the
chemical_embeddings migration; the assistant's similarity tool stays degraded
(name matching) until it has.

Safe to re-run: `refresh_chemicals` skips any chemical whose composed source
text is byte-identical to what is already indexed, so a second run over an
unchanged catalog costs nothing and embeds nothing.
"""

from __future__ import annotations

import argparse
import logging
import sys

from app.config import settings
from app.services import database, embeddings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
# httpx logs a line per request with the full URL — with ids inlined in the
# query string that is thousands of characters per chunk, and it buries the
# progress lines this script exists to show.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger("embed_backfill")

# Chemicals per refresh_chemicals() call. Each call fans out into
# embedding_batch_size-sized provider requests; this bounds how much is held in
# memory and how much is lost if the process is killed mid-run.
_CHUNK = 50


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill chemical embeddings.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-embed even when the source text is unchanged.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only process the first N chemicals (0 = all).",
    )
    args = parser.parse_args(argv)

    if not embeddings.enabled():
        # Refusing here rather than silently doing nothing: someone running a
        # backfill has an expectation, and an empty index that reports success
        # is the worst outcome.
        logger.error(
            "EMBEDDINGS_ENABLED is false — nothing to do. Set it in backend/.env "
            "and re-run."
        )
        return 2

    # Paginated: a plain select stops at PostgREST's 1000-row cap, which the
    # progress counter then reports as a complete run.
    ids = database.list_all_chemical_ids()
    if args.limit:
        ids = ids[: args.limit]
    logger.info(
        "Backfilling %d chemical(s) with %s/%s (dim=%d)%s",
        len(ids),
        settings.embedding_provider,
        settings.embedding_model,
        settings.embedding_dim,
        " [force]" if args.force else "",
    )

    totals = {"considered": 0, "embedded": 0, "skipped": 0}
    for start in range(0, len(ids), _CHUNK):
        chunk = ids[start : start + _CHUNK]
        stats = embeddings.refresh_chemicals(chunk, force=args.force)
        for key in totals:
            totals[key] += stats.get(key, 0)
        logger.info(
            "%d/%d — embedded %d, skipped %d",
            min(start + _CHUNK, len(ids)),
            len(ids),
            totals["embedded"],
            totals["skipped"],
        )

    indexed = embeddings.index_size()
    logger.info(
        "Done. embedded=%d skipped=%d; index now holds %d chemical(s).",
        totals["embedded"],
        totals["skipped"],
        indexed,
    )
    # A run that embedded nothing AND left an empty index means every provider
    # call failed (they are logged, not raised). Exit non-zero so a scripted
    # deploy notices.
    if totals["embedded"] == 0 and indexed == 0:
        logger.error("Nothing was indexed — check the provider key and logs above.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
