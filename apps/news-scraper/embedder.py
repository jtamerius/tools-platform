"""
Headline embedder and topic cluster builder.

Uses the HuggingFace Inference API (free tier) to generate sentence embeddings
for each headline, then groups headlines into clusters using cosine similarity.

This is optional — set ENABLE_EMBEDDINGS=false in .env to skip.
The output adds two things to the final JSON:
  1. Each headline gets an "embedding" (list of floats) — stored if STORE_EMBEDDINGS=true.
  2. A top-level "clusters" list groups countries by similar top headline.
"""

import asyncio
import logging
import os
from typing import Optional

import aiohttp

logger = logging.getLogger(__name__)

HF_EMBEDDING_URL = "https://api-inference.huggingface.co/models/{model}"

DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


async def _fetch_embeddings_batch(
    session: aiohttp.ClientSession,
    texts: list[str],
    model: str,
    api_key: str,
) -> Optional[list[list[float]]]:
    """Call HF feature-extraction pipeline for a batch of texts."""
    url = HF_EMBEDDING_URL.format(model=model)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"inputs": texts, "options": {"wait_for_model": True}}

    try:
        async with session.post(
            url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=60)
        ) as resp:
            if resp.status == 503:
                logger.warning("HF embedding model loading (503) — retrying after 10s")
                await asyncio.sleep(10)
                async with session.post(
                    url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=60)
                ) as resp2:
                    if resp2.status != 200:
                        logger.warning("HF embedding still failed after retry: %s", resp2.status)
                        return None
                    return await resp2.json()
            if resp.status != 200:
                body = await resp.text()
                logger.warning("HF embedding error %s: %s", resp.status, body[:200])
                return None
            return await resp.json()
    except Exception as e:
        logger.warning("HF embedding request failed: %s", e)
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    import numpy as np
    va, vb = np.array(a), np.array(b)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)


def _cluster_by_similarity(
    items: list[dict],  # each has "country_code", "country_name", "title", "embedding"
    threshold: float = 0.65,
) -> list[dict]:
    """
    Greedy single-linkage clustering by cosine similarity.

    Returns a list of clusters, each being:
    {
        "cluster_id": int,
        "representative_title": str,   # headline of the first item in cluster
        "countries": [
            {"country_code": str, "country_name": str, "title": str}
        ]
    }
    """
    clusters: list[list[int]] = []
    assigned = [False] * len(items)

    for i in range(len(items)):
        if assigned[i]:
            continue
        cluster = [i]
        assigned[i] = True
        for j in range(i + 1, len(items)):
            if assigned[j]:
                continue
            sim = _cosine_similarity(items[i]["embedding"], items[j]["embedding"])
            if sim >= threshold:
                cluster.append(j)
                assigned[j] = True
        clusters.append(cluster)

    result = []
    for cid, indices in enumerate(clusters):
        members = [items[idx] for idx in indices]
        result.append({
            "cluster_id": cid,
            "size": len(members),
            "representative_title": members[0]["title"],
            "countries": [
                {
                    "country_code": m["country_code"],
                    "country_name": m["country_name"],
                    "title": m["title"],
                }
                for m in members
            ],
        })

    # Sort largest clusters first
    result.sort(key=lambda c: c["size"], reverse=True)
    return result


async def embed_and_cluster(
    scraped_results: list[dict],
    api_key: str,
    model: str = DEFAULT_MODEL,
    similarity_threshold: float = 0.65,
    store_embeddings: bool = False,
    batch_size: int = 64,
) -> tuple[list[dict], list[dict]]:
    """
    Generate embeddings for all top headlines and compute topic clusters.

    Args:
        scraped_results:      Output from scraper (already categorized or not).
        api_key:              HuggingFace API token.
        model:                HF sentence-transformer model ID.
        similarity_threshold: Cosine similarity cutoff for same-topic grouping.
        store_embeddings:     If True, attach raw embedding vectors to each headline.
        batch_size:           How many texts to embed per API call.

    Returns:
        (enriched_scraped_results, clusters)
    """
    # Use the top headline title for each country as the text to embed.
    items = []
    for ci, country in enumerate(scraped_results):
        headlines = country.get("headlines", [])
        if not headlines:
            continue
        title = headlines[0].get("title", "").strip()
        if title:
            items.append({
                "ci": ci,
                "hi": 0,
                "country_code": country["country_code"],
                "country_name": country["country_name"],
                "title": title,
                "embedding": None,
            })

    if not items:
        return scraped_results, []

    # Batch embed
    texts = [item["title"] for item in items]
    connector = aiohttp.TCPConnector(limit=5)
    async with aiohttp.ClientSession(connector=connector) as session:
        all_embeddings: list[Optional[list[float]]] = []
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            logger.info("Embedding batch %d–%d of %d", start, start + len(batch), len(texts))
            result = await _fetch_embeddings_batch(session, batch, model, api_key)
            if result is None:
                all_embeddings.extend([None] * len(batch))
            else:
                all_embeddings.extend(result)

    # Attach embeddings back
    embeddable = []
    for item, emb in zip(items, all_embeddings):
        if emb is None:
            continue
        item["embedding"] = emb
        embeddable.append(item)
        if store_embeddings:
            scraped_results[item["ci"]]["headlines"][item["hi"]]["embedding"] = emb

    if not embeddable:
        logger.warning("No embeddings were returned; skipping clustering.")
        return scraped_results, []

    clusters = _cluster_by_similarity(embeddable, threshold=similarity_threshold)
    logger.info(
        "Clustered %d headlines into %d topic groups (threshold=%.2f)",
        len(embeddable), len(clusters), similarity_threshold,
    )
    return scraped_results, clusters
