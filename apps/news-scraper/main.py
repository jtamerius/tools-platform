#!/usr/bin/env python3
"""
News Scraper & Categorization Engine
=====================================
For each country, fetches the top story cluster from Google News via SerpAPI,
categorizes it with multiple free LLMs (producing a label + summary per provider),
optionally clusters countries by semantic similarity, and saves results to JSON.

Usage:
    python main.py                      # run with defaults from .env
    python main.py --no-categorize      # scrape only, skip LLM calls
    python main.py --no-embed           # skip embedding/clustering
    python main.py --countries US GB DE # only scrape specific countries
    python main.py --threshold 0.75     # tighter topic clusters
"""

import argparse
import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import config
from categorizer import build_providers_from_config, categorize_all
from embedder import embed_and_cluster
from scraper import scrape_all
from storage import OUTPUT_DIR, save_results

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="News Scraper & Categorization Engine")
    parser.add_argument(
        "--top-n",
        type=int,
        default=config.TOP_N_HEADLINES,
        help=f"Headlines to fetch per country (default: {config.TOP_N_HEADLINES})",
    )
    parser.add_argument(
        "--no-categorize",
        action="store_true",
        help="Skip LLM categorization (scrape only)",
    )
    parser.add_argument(
        "--no-embed",
        action="store_true",
        help="Skip embedding and clustering",
    )
    parser.add_argument(
        "--countries",
        nargs="+",
        metavar="CODE",
        help="Only scrape these country codes (e.g. US GB DE)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=config.SIMILARITY_THRESHOLD,
        help=f"Cosine similarity threshold for clustering (default: {config.SIMILARITY_THRESHOLD})",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=config.OUTPUT_DIR,
        help=f"Output directory (default: {config.OUTPUT_DIR})",
    )
    return parser.parse_args()


async def run(args: argparse.Namespace) -> None:
    start_time = time.monotonic()
    run_start = datetime.now(timezone.utc).isoformat()

    logger.info("=" * 60)
    logger.info("News Scraper starting  [top_n=%d]", args.top_n)
    logger.info("=" * 60)

    # ── 1. Scrape ──────────────────────────────────────────────────────
    logger.info("Step 1/3 — Scraping Google News RSS...")
    scraped = await scrape_all(top_n=args.top_n)

    if args.countries:
        codes = {c.upper() for c in args.countries}
        scraped = [r for r in scraped if r["country_code"] in codes]
        logger.info("Filtered to %d countries: %s", len(scraped), sorted(codes))

    successful = [r for r in scraped if r.get("headlines")]
    logger.info(
        "Scraping complete: %d/%d countries returned headlines",
        len(successful), len(scraped),
    )

    # ── 2. Categorize ─────────────────────────────────────────────────
    clusters: list[dict] = []
    providers_used: list[str] = []

    if not args.no_categorize:
        logger.info("Step 2/3 — Categorizing with LLMs...")
        providers = build_providers_from_config(config.LLM_PROVIDERS)

        if providers:
            providers_used = list(providers.keys())
            logger.info("Active providers: %s", ", ".join(providers_used))
            scraped = await categorize_all(
                scraped,
                providers=providers,
                max_concurrent_llm=config.MAX_CONCURRENT_LLM,
            )
        else:
            logger.warning(
                "No LLM providers configured. Set at least one *_API_KEY in .env "
                "and ensure *_ENABLED=true."
            )
    else:
        logger.info("Step 2/3 — Categorization skipped (--no-categorize)")

    # ── 3. Embed & cluster ────────────────────────────────────────────
    if not args.no_embed and config.ENABLE_EMBEDDINGS:
        logger.info("Step 3/3 — Embedding cluster titles and grouping by topic...")
        hf_key = os.environ.get(config.EMBEDDING_API_KEY_ENV, "")
        if not hf_key:
            logger.warning(
                "ENABLE_EMBEDDINGS=true but %s is not set — skipping.",
                config.EMBEDDING_API_KEY_ENV,
            )
        else:
            scraped, clusters = await embed_and_cluster(
                scraped,
                api_key=hf_key,
                model=config.EMBEDDING_MODEL,
                similarity_threshold=args.threshold,
                store_embeddings=config.STORE_EMBEDDINGS,
                batch_size=config.EMBEDDING_BATCH_SIZE,
            )
            logger.info("Grouped countries into %d topic clusters", len(clusters))
    else:
        logger.info("Step 3/3 — Embedding/clustering skipped")

    # ── 4. Save ────────────────────────────────────────────────────────
    elapsed = time.monotonic() - start_time
    run_metadata = {
        "run_started_at": run_start,
        "top_n_headlines": args.top_n,
        "categorization_enabled": not args.no_categorize,
        "embeddings_enabled": not args.no_embed and config.ENABLE_EMBEDDINGS,
        "similarity_threshold": args.threshold,
        "elapsed_seconds": round(elapsed, 2),
        "providers_used": providers_used,
    }

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = Path(__file__).parent / output_dir

    filepath = save_results(scraped, clusters, run_metadata, output_dir=output_dir)

    logger.info("=" * 60)
    logger.info("Done in %.1fs — output: %s", elapsed, filepath)

    if clusters:
        logger.info("Top 5 topic clusters across countries:")
        for c in clusters[:5]:
            names = ", ".join(m["country_name"] for m in c["countries"][:6])
            if len(c["countries"]) > 6:
                names += f" +{len(c['countries']) - 6} more"
            logger.info("  [%2d countries] %s", c["size"], c["representative_title"][:70])
            logger.info("                 %s", names)

    logger.info("=" * 60)


def main() -> None:
    args = parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
