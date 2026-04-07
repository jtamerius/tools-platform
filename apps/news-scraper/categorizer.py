"""
Multi-LLM headline categorizer.

Takes the full article list for a country's top story cluster and asks
each LLM to produce:
  - label:   a short category label (2–5 words, Title Case)
  - summary: a 2–3 sentence summary of what is happening

Supported providers:
  groq        — Llama 3.3 70B via Groq API (free tier, very fast)
  gemini      — Gemini 2.0 Flash via Google AI Studio (free tier)
  huggingface — Mistral 7B via HF Inference API (free tier)
  openrouter  — Llama 3.2 3B via OpenRouter free model
"""

import asyncio
import json
import logging
import os
import re
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

# Max articles sent to the LLM per country (to stay within context limits)
MAX_ARTICLES_IN_PROMPT = 10

SYSTEM_PROMPT = (
    "You are a concise news analyst. When given a list of article headlines and snippets, "
    "you always respond ONLY with valid JSON — no markdown, no explanation, nothing else."
)

def _build_user_prompt(country_name: str, articles: list[dict]) -> str:
    lines = []
    for i, art in enumerate(articles[:MAX_ARTICLES_IN_PROMPT], 1):
        title = art.get("title", "").strip()
        snippet = art.get("snippet", "").strip()
        line = f"{i}. {title}"
        if snippet:
            line += f" — {snippet}"
        lines.append(line)

    article_block = "\n".join(lines)

    return f"""The following headlines and snippets are from the top news story in {country_name} right now:

{article_block}

Based on these, respond ONLY with this JSON (no markdown fences, no extra keys):
{{"label": "<2-5 word Title Case category>", "summary": "<2-3 sentence summary of what is happening>"}}"""


# ---------------------------------------------------------------------------
# Response parser — handles LLMs that wrap JSON in markdown code fences
# ---------------------------------------------------------------------------

def _parse_label_summary(raw: str) -> Optional[dict]:
    """
    Extract {label, summary} from a raw LLM response string.
    Handles:
      - Clean JSON: {"label": "...", "summary": "..."}
      - Markdown-fenced: ```json\n{...}\n```
      - Partial / malformed JSON (best-effort)
    """
    if not raw:
        return None

    # Strip markdown code fences
    clean = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`").strip()

    # Try direct parse
    try:
        data = json.loads(clean)
        if "label" in data and "summary" in data:
            return {"label": str(data["label"]).strip(), "summary": str(data["summary"]).strip()}
    except json.JSONDecodeError:
        pass

    # Fallback: regex extract
    label_match = re.search(r'"label"\s*:\s*"([^"]+)"', clean)
    summary_match = re.search(r'"summary"\s*:\s*"([^"]+)"', clean)
    if label_match and summary_match:
        return {"label": label_match.group(1).strip(), "summary": summary_match.group(1).strip()}

    logger.debug("Could not parse LLM response: %s", raw[:200])
    return None


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------

async def _call_groq(
    session: aiohttp.ClientSession, country_name: str, articles: list[dict], cfg: dict
) -> Optional[dict]:
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(country_name, articles)},
        ],
        "max_tokens": 200,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
        if resp.status != 200:
            logger.warning("Groq error %s for %s", resp.status, country_name)
            return None
        data = await resp.json()
        return _parse_label_summary(data["choices"][0]["message"]["content"])


async def _call_gemini(
    session: aiohttp.ClientSession, country_name: str, articles: list[dict], cfg: dict
) -> Optional[dict]:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent"
        f"?key={cfg['api_key']}"
    )
    full_prompt = SYSTEM_PROMPT + "\n\n" + _build_user_prompt(country_name, articles)
    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"maxOutputTokens": 200, "temperature": 0.2},
    }
    headers = {"Content-Type": "application/json"}
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
        if resp.status != 200:
            logger.warning("Gemini error %s for %s", resp.status, country_name)
            return None
        data = await resp.json()
        try:
            raw = data["candidates"][0]["content"]["parts"][0]["text"]
            return _parse_label_summary(raw)
        except (KeyError, IndexError):
            return None


async def _call_huggingface(
    session: aiohttp.ClientSession, country_name: str, articles: list[dict], cfg: dict
) -> Optional[dict]:
    url = f"https://api-inference.huggingface.co/models/{cfg['model']}"
    prompt = (
        f"<s>[INST] {SYSTEM_PROMPT}\n\n{_build_user_prompt(country_name, articles)} [/INST]"
    )
    payload = {
        "inputs": prompt,
        "parameters": {"max_new_tokens": 200, "temperature": 0.2, "return_full_text": False},
    }
    headers = {"Authorization": f"Bearer {cfg['api_key']}", "Content-Type": "application/json"}
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=40)) as resp:
        if resp.status == 503:
            logger.warning("HuggingFace model loading (503) for %s, skipping", country_name)
            return None
        if resp.status != 200:
            logger.warning("HuggingFace error %s for %s", resp.status, country_name)
            return None
        data = await resp.json()
        if isinstance(data, list) and data:
            return _parse_label_summary(data[0].get("generated_text", ""))
        return None


async def _call_openrouter(
    session: aiohttp.ClientSession, country_name: str, articles: list[dict], cfg: dict
) -> Optional[dict]:
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(country_name, articles)},
        ],
        "max_tokens": 200,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/jtamerius/website_hub",
        "X-Title": "News Scraper Categorizer",
    }
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
        if resp.status != 200:
            logger.warning("OpenRouter error %s for %s", resp.status, country_name)
            return None
        data = await resp.json()
        return _parse_label_summary(data["choices"][0]["message"]["content"])


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

PROVIDER_FNS = {
    "groq": _call_groq,
    "gemini": _call_gemini,
    "huggingface": _call_huggingface,
    "openrouter": _call_openrouter,
}


async def _run_provider(
    session: aiohttp.ClientSession,
    name: str,
    cfg: dict,
    country_name: str,
    articles: list[dict],
    semaphore: asyncio.Semaphore,
) -> tuple[str, Optional[dict]]:
    fn = PROVIDER_FNS[name]
    async with semaphore:
        try:
            result = await fn(session, country_name, articles, cfg)
            return name, result
        except Exception as e:
            logger.warning("Provider %s raised for %s: %s", name, country_name, e)
            return name, None


async def categorize_country(
    session: aiohttp.ClientSession,
    country_name: str,
    articles: list[dict],
    providers: dict,
    semaphore: asyncio.Semaphore,
) -> dict:
    """
    Categorize a country's top story cluster using all enabled providers in parallel.

    Returns:
        {
            "groq":        {"label": "Iran Nuclear Deal", "summary": "..."},
            "gemini":      {"label": "Iran Nuclear Talks", "summary": "..."},
            "huggingface": {"label": "Middle East Diplomacy", "summary": "..."},
            "openrouter":  {"label": "Iran Nuclear Deal", "summary": "..."},
        }
    """
    tasks = [
        _run_provider(session, name, cfg, country_name, articles, semaphore)
        for name, cfg in providers.items()
        if cfg.get("enabled") and cfg.get("api_key")
    ]
    if not tasks:
        return {}
    results = await asyncio.gather(*tasks)
    return {name: result for name, result in results}


async def categorize_all(
    scraped_results: list[dict],
    providers: dict,
    max_concurrent_llm: int = 5,
) -> list[dict]:
    """
    Attach LLM categorization to every country's top_story in-place.

    Adds a "categorization" key to each top_story:
        {
            "groq":    {"label": "...", "summary": "..."},
            "gemini":  {"label": "...", "summary": "..."},
            ...
        }

    Returns the enriched scraped_results list.
    """
    semaphore = asyncio.Semaphore(max_concurrent_llm)
    to_categorize = [
        (ci, r)
        for ci, r in enumerate(scraped_results)
        if r.get("top_story") and r["top_story"].get("articles")
    ]

    if not to_categorize:
        return scraped_results

    connector = aiohttp.TCPConnector(limit=20)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            categorize_country(
                session,
                r["country_name"],
                r["top_story"]["articles"],
                providers,
                semaphore,
            )
            for _, r in to_categorize
        ]
        results = await asyncio.gather(*tasks)

    for (ci, _), cat in zip(to_categorize, results):
        scraped_results[ci]["top_story"]["categorization"] = cat

    logger.info(
        "Categorized top stories for %d countries with providers: %s",
        len(to_categorize),
        ", ".join(providers.keys()),
    )
    return scraped_results


def build_providers_from_config(provider_configs: dict) -> dict:
    """Resolve API keys from environment and return only ready providers."""
    resolved = {}
    for name, cfg in provider_configs.items():
        if not cfg.get("enabled", False):
            continue
        api_key = os.environ.get(cfg.get("api_key_env", ""), "")
        if not api_key:
            logger.warning(
                "Provider '%s' enabled but %s not set — skipping.",
                name, cfg.get("api_key_env"),
            )
            continue
        resolved[name] = {**cfg, "api_key": api_key}
    return resolved
