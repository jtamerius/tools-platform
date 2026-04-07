"""
SerpAPI-based Google News scraper.

For each country this performs two API calls:
  1. Google News search  → get top story cluster + its story_token
  2. story_token lookup  → get every article in that cluster (with snippets)

The result per country is structured as:
  {
      "country_code": str,
      "country_name": str,
      "top_story": {
          "story_token":   str | None,
          "cluster_title": str,        # Google's label for the story cluster
          "articles": [
              {"title": str, "snippet": str, "source": str, "link": str, "date": str}
          ]
      },
      "scraped_at": str (ISO),
      "error": str | None
  }

NOTE on SerpAPI quotas:
  Free tier = 100 searches/month.
  This scraper makes up to 2 calls per country, so ~200 calls per full run.
  A paid plan is required for full coverage of all ~100 countries.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import aiohttp

from countries import COUNTRIES

logger = logging.getLogger(__name__)

SERPAPI_BASE = "https://serpapi.com/search.json"

# Respect SerpAPI rate limits — keep concurrent calls low
MAX_CONCURRENT = 5


async def _get(
    session: aiohttp.ClientSession,
    params: dict,
) -> Optional[dict]:
    """GET a SerpAPI endpoint, returning parsed JSON or None on error."""
    try:
        async with session.get(
            SERPAPI_BASE,
            params=params,
            timeout=aiohttp.ClientTimeout(total=20),
        ) as resp:
            if resp.status == 429:
                logger.warning("SerpAPI rate limit hit (429)")
                return None
            if resp.status != 200:
                body = await resp.text()
                logger.warning("SerpAPI HTTP %s: %s", resp.status, body[:200])
                return None
            return await resp.json()
    except asyncio.TimeoutError:
        logger.warning("SerpAPI request timed out")
        return None
    except aiohttp.ClientError as e:
        logger.warning("SerpAPI client error: %s", e)
        return None


def _extract_story_token(cluster: dict) -> Optional[str]:
    """
    Find the story_token in a news_results cluster item.
    SerpAPI can put it directly on the cluster or inside its stories list.
    """
    token = cluster.get("story_token")
    if token:
        return token
    for story in cluster.get("stories", []):
        token = story.get("story_token")
        if token:
            return token
    return None


def _parse_articles(raw_articles: list[dict]) -> list[dict]:
    """Normalize a list of raw SerpAPI article dicts."""
    out = []
    for art in raw_articles:
        source = art.get("source", {})
        source_name = source.get("name", "") if isinstance(source, dict) else str(source)
        title = art.get("title", "").strip()
        if not title:
            continue
        out.append({
            "title": title,
            "snippet": art.get("snippet", "").strip(),
            "source": source_name,
            "link": art.get("link", ""),
            "date": art.get("date", ""),
        })
    return out


async def fetch_country_top_story(
    session: aiohttp.ClientSession,
    country_code: str,
    lang: str,
    locale: str,
    display_name: str,
    api_key: str,
    semaphore: asyncio.Semaphore,
) -> dict:
    """
    Fetch the top story cluster for one country using SerpAPI.
    Makes up to 2 API calls: news search + story_token cluster drill-down.
    """
    scraped_at = datetime.now(timezone.utc).isoformat()

    def _empty(error: str) -> dict:
        return {
            "country_code": country_code,
            "country_name": display_name,
            "top_story": None,
            "scraped_at": scraped_at,
            "error": error,
        }

    async with semaphore:
        # ── Call 1: Get news results for this country ──────────────────
        data = await _get(session, {
            "engine": "google_news",
            "gl": country_code,
            "hl": lang,
            "api_key": api_key,
        })

    if not data:
        return _empty("serpapi_call_failed")

    news_results = data.get("news_results", [])
    if not news_results:
        return _empty("no_news_results")

    top_cluster = news_results[0]
    cluster_title: str = top_cluster.get("title", "").strip()
    story_token: Optional[str] = _extract_story_token(top_cluster)

    # ── Call 2: Drill into story cluster via story_token ───────────────
    articles: list[dict] = []

    if story_token:
        async with semaphore:
            cluster_data = await _get(session, {
                "engine": "google_news",
                "story_token": story_token,
                "api_key": api_key,
            })

        if cluster_data:
            # SerpAPI returns the full article list under "cluster_articles"
            raw = cluster_data.get("cluster_articles", [])
            articles = _parse_articles(raw)

    # Fallback: use the stories embedded in the first call's cluster
    if not articles:
        fallback = top_cluster.get("stories", [])
        articles = _parse_articles(fallback)
        if not story_token:
            logger.debug(
                "%s: no story_token found, using %d inline stories",
                display_name, len(articles),
            )

    if not articles:
        return _empty("no_articles_found")

    logger.info(
        "%-30s top story: %d articles — %s",
        display_name, len(articles), cluster_title[:60],
    )

    return {
        "country_code": country_code,
        "country_name": display_name,
        "top_story": {
            "story_token": story_token,
            "cluster_title": cluster_title,
            "articles": articles,
        },
        "scraped_at": scraped_at,
        "error": None,
    }


async def scrape_all(api_key: str) -> list[dict]:
    """
    Scrape the top story for every country in countries.COUNTRIES.

    Args:
        api_key: SerpAPI API key.

    Returns:
        List of country result dicts (including those with errors).
    """
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT)

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            fetch_country_top_story(session, code, lang, locale, name, api_key, semaphore)
            for code, lang, locale, name in COUNTRIES
        ]
        results = await asyncio.gather(*tasks)

    successful = sum(1 for r in results if not r["error"])
    logger.info(
        "Scraping complete: %d/%d countries returned a top story",
        successful, len(COUNTRIES),
    )
    return list(results)
