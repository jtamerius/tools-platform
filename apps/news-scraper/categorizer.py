"""
Multi-LLM headline categorizer.

Sends each headline to all enabled free LLM providers in parallel and
collects a short category label from each. This lets you compare how
different models categorize the same news.

Supported providers:
  - groq       (Llama 3.3 70B / Mixtral — free tier)
  - gemini     (Gemini 2.0 Flash — free tier)
  - huggingface(Mistral 7B via HF Inference API — free tier)
  - openrouter (Llama 3.2 3B free model)
"""

import asyncio
import json
import logging
import os
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

CATEGORIZE_PROMPT = """You are a news analyst. Given the following news headline, respond with ONLY a short category label (2–5 words, title case) that captures the main topic or event. Do not explain, do not use quotes, just the label.

Headline: {headline}

Category:"""


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------

async def _call_groq(session: aiohttp.ClientSession, headline: str, cfg: dict) -> Optional[str]:
    """Groq API — OpenAI-compatible chat completions."""
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": CATEGORIZE_PROMPT.format(headline=headline)}],
        "max_tokens": 20,
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            body = await resp.text()
            logger.warning("Groq error %s: %s", resp.status, body[:200])
            return None
        data = await resp.json()
        return data["choices"][0]["message"]["content"].strip()


async def _call_gemini(session: aiohttp.ClientSession, headline: str, cfg: dict) -> Optional[str]:
    """Google Gemini REST API."""
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent"
        f"?key={cfg['api_key']}"
    )
    payload = {
        "contents": [{"parts": [{"text": CATEGORIZE_PROMPT.format(headline=headline)}]}],
        "generationConfig": {"maxOutputTokens": 20, "temperature": 0.1},
    }
    headers = {"Content-Type": "application/json"}
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            body = await resp.text()
            logger.warning("Gemini error %s: %s", resp.status, body[:200])
            return None
        data = await resp.json()
        try:
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except (KeyError, IndexError):
            logger.warning("Unexpected Gemini response shape: %s", data)
            return None


async def _call_huggingface(session: aiohttp.ClientSession, headline: str, cfg: dict) -> Optional[str]:
    """HuggingFace Inference API — text generation."""
    url = f"https://api-inference.huggingface.co/models/{cfg['model']}"
    prompt = CATEGORIZE_PROMPT.format(headline=headline)
    payload = {
        "inputs": prompt,
        "parameters": {"max_new_tokens": 20, "temperature": 0.1, "return_full_text": False},
    }
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
    }
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as resp:
        if resp.status == 503:
            # Model loading — common on free tier
            logger.warning("HuggingFace model loading (503), skipping")
            return None
        if resp.status != 200:
            body = await resp.text()
            logger.warning("HuggingFace error %s: %s", resp.status, body[:200])
            return None
        data = await resp.json()
        if isinstance(data, list) and data:
            raw = data[0].get("generated_text", "")
            # Strip the prompt if the model echoed it back
            if raw.startswith(prompt):
                raw = raw[len(prompt):]
            return raw.strip().split("\n")[0].strip()
        return None


async def _call_openrouter(session: aiohttp.ClientSession, headline: str, cfg: dict) -> Optional[str]:
    """OpenRouter API — OpenAI-compatible, free models available."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [{"role": "user", "content": CATEGORIZE_PROMPT.format(headline=headline)}],
        "max_tokens": 20,
        "temperature": 0.1,
    }
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/jtamerius/website_hub",
        "X-Title": "News Scraper Categorizer",
    }
    async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
        if resp.status != 200:
            body = await resp.text()
            logger.warning("OpenRouter error %s: %s", resp.status, body[:200])
            return None
        data = await resp.json()
        return data["choices"][0]["message"]["content"].strip()


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

PROVIDER_FNS = {
    "groq": _call_groq,
    "gemini": _call_gemini,
    "huggingface": _call_huggingface,
    "openrouter": _call_openrouter,
}


async def _categorize_with_provider(
    session: aiohttp.ClientSession,
    provider_name: str,
    cfg: dict,
    headline: str,
    semaphore: asyncio.Semaphore,
) -> tuple[str, Optional[str]]:
    """Call a single provider and return (provider_name, category_label)."""
    fn = PROVIDER_FNS[provider_name]
    async with semaphore:
        try:
            label = await fn(session, headline, cfg)
            # Sanitize: strip surrounding quotes/whitespace
            if label:
                label = label.strip().strip('"').strip("'").strip()
            return provider_name, label
        except Exception as e:
            logger.warning("Provider %s raised: %s", provider_name, e)
            return provider_name, None


async def categorize_headline(
    session: aiohttp.ClientSession,
    headline: str,
    providers: dict,
    semaphore: asyncio.Semaphore,
) -> dict:
    """
    Categorize a single headline using all enabled providers in parallel.

    Returns:
        {
            "headline": str,
            "categories": {
                "groq": "Iran Nuclear Deal",
                "gemini": "Iran Nuclear Negotiations",
                ...
            }
        }
    """
    tasks = [
        _categorize_with_provider(session, name, cfg, headline, semaphore)
        for name, cfg in providers.items()
        if cfg.get("enabled") and cfg.get("api_key")
    ]

    if not tasks:
        logger.warning("No LLM providers are enabled/configured. Skipping categorization.")
        return {"headline": headline, "categories": {}}

    results = await asyncio.gather(*tasks)
    return {
        "headline": headline,
        "categories": {name: label for name, label in results},
    }


async def categorize_all(
    scraped_results: list[dict],
    providers: dict,
    max_concurrent_llm: int = 5,
) -> list[dict]:
    """
    Attach LLM category labels to every headline in every country result.

    Modifies each headline dict in-place to add a "categorization" key:
        {
            "title": "...",
            "link": "...",
            ...
            "categorization": {
                "groq": "Iran Nuclear Deal",
                "gemini": "Iran Nuclear Negotiations",
            }
        }

    Returns the enriched scraped_results list.
    """
    semaphore = asyncio.Semaphore(max_concurrent_llm)

    # Collect all (country_idx, headline_idx, headline_text) triples
    to_categorize = []
    for ci, country in enumerate(scraped_results):
        for hi, headline in enumerate(country.get("headlines", [])):
            title = headline.get("title", "")
            if title:
                to_categorize.append((ci, hi, title))

    if not to_categorize:
        return scraped_results

    connector = aiohttp.TCPConnector(limit=20)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            categorize_headline(session, title, providers, semaphore)
            for _, _, title in to_categorize
        ]
        results = await asyncio.gather(*tasks)

    for (ci, hi, _), cat_result in zip(to_categorize, results):
        scraped_results[ci]["headlines"][hi]["categorization"] = cat_result["categories"]

    total = len(to_categorize)
    logger.info("Categorized %d headlines across %d countries", total, len(scraped_results))
    return scraped_results


def build_providers_from_config(provider_configs: dict) -> dict:
    """
    Resolve API keys from environment variables and return only enabled,
    key-bearing providers.
    """
    resolved = {}
    for name, cfg in provider_configs.items():
        if not cfg.get("enabled", False):
            continue
        api_key = os.environ.get(cfg.get("api_key_env", ""), "")
        if not api_key:
            logger.warning("Provider '%s' enabled but %s is not set — skipping.", name, cfg.get("api_key_env"))
            continue
        resolved[name] = {**cfg, "api_key": api_key}
    return resolved
