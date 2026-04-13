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

import xml.etree.ElementTree as ET

import aiohttp

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

# Sources excluded from all country feeds.
# Matched against the domain in the RSS <source url="..."> attribute.
EXCLUDED_DOMAINS = frozenset({
    "univision.com",
    "telemundo.com",
    "cnn.com",
    "apnews.com",
    "reuters.com",
    "skynewsarabia.com",
    "lemonde.fr",
})

# Sources excluded everywhere EXCEPT for listed country codes.
EXCLUDED_DOMAINS_EXCEPT: dict[str, frozenset[str]] = {
    "nbcnews.com": frozenset({"US"}),
}


def _is_excluded(source_url: str, country_code: str) -> bool:
    """Return True if the source should be skipped for this country."""
    try:
        host = source_url.split("//")[-1].split("/")[0].lower()
        host = host.removeprefix("www.")
        if any(host == d or host.endswith("." + d) for d in EXCLUDED_DOMAINS):
            return True
        for domain, allowed in EXCLUDED_DOMAINS_EXCEPT.items():
            if (host == domain or host.endswith("." + domain)) and country_code not in allowed:
                return True
    except Exception:
        pass
    return False


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

    headlines = _parse_rss(content, top_n, country_code)

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


def _parse_rss(content: bytes, top_n: int, country_code: str = '') -> list[dict]:
    """Parse RSS XML bytes into a list of headline dicts."""
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        return []

    # Namespace used by Google News RSS for <source>
    ns = {"news": "http://www.google.com/schemas/news/1.0"}
    channel = root.find("channel")
    if channel is None:
        return []

    headlines = []
    # Scan up to 5× top_n items so exclusions don't leave us short
    for item in channel.findall("item")[:top_n * 5]:
        if len(headlines) >= top_n:
            break

        title = (item.findtext("title") or "").strip()
        if not title:
            continue

        # Google News wraps source name in <source url="...">Name</source>
        source_el = item.find("source")
        source_url = source_el.get("url", "") if source_el is not None else ""
        if source_url and _is_excluded(source_url, country_code):
            logger.debug("Skipping excluded source: %s", source_url)
            continue

        source = source_el.text.strip() if source_el is not None and source_el.text else None

        headlines.append({
            "title": title,
            "link": (item.findtext("link") or "").strip(),
            "published": (item.findtext("pubDate") or "").strip() or None,
            "source": source,
        })

    return headlines


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
