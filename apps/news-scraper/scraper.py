"""
Async Google News RSS scraper.
Fetches the top N headlines for each country using Google News RSS feeds.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional

import aiohttp
import feedparser

from countries import COUNTRIES

logger = logging.getLogger(__name__)

GOOGLE_NEWS_RSS = "https://news.google.com/rss?hl={locale}&gl={country_code}&ceid={country_code}:{lang}"

# Realistic browser headers to avoid 429s
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

# Max concurrent RSS requests to avoid hammering Google
MAX_CONCURRENT = 10


async def fetch_feed(
    session: aiohttp.ClientSession,
    country_code: str,
    lang: str,
    locale: str,
    display_name: str,
    top_n: int,
    semaphore: asyncio.Semaphore,
) -> dict:
    """Fetch and parse Google News RSS for a single country."""
    url = GOOGLE_NEWS_RSS.format(locale=locale, country_code=country_code, lang=lang)
    async with semaphore:
        try:
            async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status != 200:
                    logger.warning("HTTP %s for %s (%s)", resp.status, display_name, url)
                    return _empty_result(country_code, display_name, url, error=f"HTTP {resp.status}")
                content = await resp.read()
        except asyncio.TimeoutError:
            logger.warning("Timeout fetching %s", display_name)
            return _empty_result(country_code, display_name, url, error="timeout")
        except aiohttp.ClientError as e:
            logger.warning("Client error fetching %s: %s", display_name, e)
            return _empty_result(country_code, display_name, url, error=str(e))

    feed = feedparser.parse(content)
    entries = feed.entries[:top_n]

    headlines = []
    for entry in entries:
        published = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                published = datetime(*entry.published_parsed[:6]).isoformat()
            except Exception:
                pass

        headlines.append({
            "title": entry.get("title", "").strip(),
            "link": entry.get("link", ""),
            "published": published,
            "source": _extract_source(entry),
        })

    return {
        "country_code": country_code,
        "country_name": display_name,
        "language": lang,
        "locale": locale,
        "feed_url": url,
        "scraped_at": datetime.utcnow().isoformat(),
        "headlines": headlines,
        "error": None,
    }


def _extract_source(entry) -> Optional[str]:
    """Pull the publisher name out of the RSS entry if available."""
    # Google News RSS includes <source> tags
    if hasattr(entry, "source") and isinstance(entry.source, dict):
        return entry.source.get("title")
    # Sometimes it's in tags
    if hasattr(entry, "tags"):
        for tag in entry.tags:
            if tag.get("scheme", "").endswith("source"):
                return tag.get("term")
    return None


def _empty_result(country_code: str, display_name: str, url: str, error: str) -> dict:
    return {
        "country_code": country_code,
        "country_name": display_name,
        "language": None,
        "locale": None,
        "feed_url": url,
        "scraped_at": datetime.utcnow().isoformat(),
        "headlines": [],
        "error": error,
    }


async def scrape_all(top_n: int = 1) -> list[dict]:
    """
    Scrape Google News RSS for all countries concurrently.

    Args:
        top_n: Number of top headlines to fetch per country (default 1).

    Returns:
        List of country result dicts, including those with errors.
    """
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    connector = aiohttp.TCPConnector(limit=MAX_CONCURRENT)

    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            fetch_feed(session, code, lang, locale, name, top_n, semaphore)
            for code, lang, locale, name in COUNTRIES
        ]
        results = await asyncio.gather(*tasks)

    successful = sum(1 for r in results if not r["error"] and r["headlines"])
    logger.info("Scraped %d/%d countries successfully", successful, len(COUNTRIES))
    return list(results)
