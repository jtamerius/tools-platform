"""
Async Google News RSS scraper.
Fetches the top N headlines for each country using Google News RSS feeds.

RSS URL format:
  https://news.google.com/rss?hl={locale}&gl={country_code}&ceid={country_code}:{lang}

No API key required. Free, no rate limits.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import aiohttp
import feedparser

from countries import COUNTRIES

logger = logging.getLogger(__name__)

GOOGLE_NEWS_RSS = (
    "https://news.google.com/rss?hl={locale}&gl={country_code}&ceid={country_code}:{lang}"
)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

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
            async with session.get(
                url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status != 200:
                    logger.warning("HTTP %s for %s", resp.status, display_name)
                    return _empty(country_code, display_name, lang, locale, url, f"HTTP {resp.status}")
                content = await resp.read()
        except asyncio.TimeoutError:
            return _empty(country_code, display_name, lang, locale, url, "timeout")
        except aiohttp.ClientError as e:
            return _empty(country_code, display_name, lang, locale, url, str(e))

    feed = feedparser.parse(content)
    headlines = []
    for entry in feed.entries[:top_n]:
        published = None
        if hasattr(entry, "published_parsed") and entry.published_parsed:
            try:
                published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass

        headlines.append({
            "title": entry.get("title", "").strip(),
            "link": entry.get("link", ""),
            "published": published,
            "source": _extract_source(entry),
        })

    logger.info("%-30s %d headline(s)", display_name, len(headlines))

    return {
        "country_code": country_code,
        "country_name": display_name,
        "language": lang,
        "locale": locale,
        "feed_url": url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "headlines": headlines,
        "error": None,
    }


def _extract_source(entry) -> Optional[str]:
    if hasattr(entry, "source") and isinstance(entry.source, dict):
        return entry.source.get("title")
    if hasattr(entry, "tags"):
        for tag in entry.tags:
            if tag.get("scheme", "").endswith("source"):
                return tag.get("term")
    return None


def _empty(country_code, display_name, lang, locale, url, error) -> dict:
    return {
        "country_code": country_code,
        "country_name": display_name,
        "language": lang,
        "locale": locale,
        "feed_url": url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
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

    successful = sum(1 for r in results if r["headlines"])
    logger.info("Scraped %d/%d countries successfully", successful, len(COUNTRIES))
    return list(results)
