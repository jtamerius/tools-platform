"""
Multi-LLM headline categorizer.

Takes a single headline title and asks each LLM to produce:
  - label:   a short category label (2–5 words, Title Case)
  - summary: a 2–3 sentence explanation of what this story is likely about

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

SYSTEM_PROMPT = (
    "You are a concise news analyst. When given a news headline, "
    "you always respond ONLY with valid JSON — no markdown, no explanation, nothing else."
)


def _build_user_prompt(headline: str, country_name: str) -> str:
    return f"""This is the top news headline in {country_name} right now:

\"{headline}\"

Based on this headline, respond ONLY with this JSON (no markdown fences, no extra keys):
{{"title_en": "<the headline translated to English, or the original if already English>", "label": "<2-5 word Title Case topic category>", "summary": "<2-3 sentences explaining what this story is likely about and why it matters>"}}"""


# ---------------------------------------------------------------------------
# Response parser — handles LLMs that wrap JSON in markdown code fences
# ---------------------------------------------------------------------------

def _parse_label_summary(raw: str) -> Optional[dict]:
    if not raw:
        return None

    # Strip markdown code fences
    clean = re.sub(r"```(?:json)?\s*", "", raw).strip().strip("`").strip()

    try:
        data = json.loads(clean)
        if "label" in data and "summary" in data:
            result = {"label": str(data["label"]).strip(), "summary": str(data["summary"]).strip()}
            if "title_en" in data:
                result["title_en"] = str(data["title_en"]).strip()
            return result
    except json.JSONDecodeError:
        pass

    # Fallback: regex extract
    label_match = re.search(r'"label"\s*:\s*"([^"]+)"', clean)
    summary_match = re.search(r'"summary"\s*:\s*"([^"]+)"', clean)
    title_en_match = re.search(r'"title_en"\s*:\s*"([^"]+)"', clean)
    if label_match and summary_match:
        result = {"label": label_match.group(1).strip(), "summary": summary_match.group(1).strip()}
        if title_en_match:
            result["title_en"] = title_en_match.group(1).strip()
        return result

    logger.debug("Could not parse LLM response: %s", raw[:200])
    return None


# ---------------------------------------------------------------------------
# Provider implementations
# ---------------------------------------------------------------------------

async def _call_groq(
    session: aiohttp.ClientSession, headline: str, country_name: str, cfg: dict
) -> Optional[dict]:
    url = "https://api.groq.com/openai/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(headline, country_name)},
        ],
        "max_tokens": 200,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {cfg['api_key']}",
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate",
    }
    for attempt in range(4):
        async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
            if resp.status == 429:
                await asyncio.sleep(10 * (attempt + 1))  # 10s, 20s, 30s, 40s
                continue
            if resp.status != 200:
                logger.warning("Groq error %s for %s", resp.status, country_name)
                return None
            data = await resp.json()
            return _parse_label_summary(data["choices"][0]["message"]["content"])
    logger.warning("Groq gave up after retries for %s", country_name)
    return None


async def _call_gemini(
    session: aiohttp.ClientSession, headline: str, country_name: str, cfg: dict
) -> Optional[dict]:
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{cfg['model']}:generateContent"
        f"?key={cfg['api_key']}"
    )
    full_prompt = SYSTEM_PROMPT + "\n\n" + _build_user_prompt(headline, country_name)
    payload = {
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"maxOutputTokens": 200, "temperature": 0.2},
    }
    headers = {"Content-Type": "application/json"}
    for attempt in range(3):
        async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=25)) as resp:
            if resp.status == 429:
                await asyncio.sleep(5)
                continue
            if resp.status != 200:
                logger.warning("Gemini error %s for %s", resp.status, country_name)
                return None
            data = await resp.json()
            try:
                raw = data["candidates"][0]["content"]["parts"][0]["text"]
                return _parse_label_summary(raw)
            except (KeyError, IndexError):
                return None
    logger.warning("Gemini gave up after retries for %s", country_name)
    return None


async def _call_huggingface(
    session: aiohttp.ClientSession, headline: str, country_name: str, cfg: dict
) -> Optional[dict]:
    url = f"https://api-inference.huggingface.co/models/{cfg['model']}"
    prompt = (
        f"<s>[INST] {SYSTEM_PROMPT}\n\n{_build_user_prompt(headline, country_name)} [/INST]"
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
    session: aiohttp.ClientSession, headline: str, country_name: str, cfg: dict
) -> Optional[dict]:
    url = "https://openrouter.ai/api/v1/chat/completions"
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(headline, country_name)},
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
    headline: str,
    country_name: str,
    semaphore: asyncio.Semaphore,
) -> tuple[str, Optional[dict]]:
    fn = PROVIDER_FNS[name]
    async with semaphore:
        try:
            return name, await fn(session, headline, country_name, cfg)
        except Exception as e:
            logger.warning("Provider %s raised for %s: %s", name, country_name, e)
            return name, None


async def categorize_all(
    scraped_results: list[dict],
    providers: dict,
    max_concurrent_llm: int = 5,
) -> list[dict]:
    """
    Attach LLM categorization to every headline in every country result in-place.

    Adds a "categorization" key to each headline dict:
        {
            "title": "...",
            ...
            "categorization": {
                "groq":        {"label": "Iran Nuclear Deal", "summary": "..."},
                "gemini":      {"label": "Iran Nuclear Talks", "summary": "..."},
                "huggingface": {"label": "Middle East Diplomacy", "summary": "..."},
                "openrouter":  {"label": "Iran Nuclear Deal", "summary": "..."},
            }
        }
    """
    semaphore = asyncio.Semaphore(max_concurrent_llm)

    # Collect (country_idx, headline_idx, title, country_name) tuples
    to_categorize = [
        (ci, hi, h["title"], r["country_name"])
        for ci, r in enumerate(scraped_results)
        for hi, h in enumerate(r.get("headlines", []))
        if h.get("title")
    ]

    if not to_categorize:
        return scraped_results

    connector = aiohttp.TCPConnector(limit=20)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [
            asyncio.gather(*[
                _run_provider(session, name, cfg, title, country_name, semaphore)
                for name, cfg in providers.items()
                if cfg.get("enabled") and cfg.get("api_key")
            ])
            for _, _, title, country_name in to_categorize
        ]
        all_results = await asyncio.gather(*tasks)

    for (ci, hi, _, _), provider_results in zip(to_categorize, all_results):
        scraped_results[ci]["headlines"][hi]["categorization"] = {
            name: result for name, result in provider_results
        }

    logger.info(
        "Categorized %d headlines across %d countries",
        len(to_categorize), len(scraped_results),
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
