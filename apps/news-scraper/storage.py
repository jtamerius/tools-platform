"""
JSON storage for scraper results.

Each run is saved to output/results_YYYY-MM-DD_HH-MM-SS.json.
A latest.json symlink (or copy) is also maintained for easy access.
"""

import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_PROVIDERS = ["groq", "gemini", "huggingface", "openrouter"]
_MAX_HISTORY = 90


def _build_snapshot(scraped_results: list[dict], run_ts: str) -> dict:
    """Build a lean {country_code: {label, topic, title_en}} snapshot for history."""
    countries = {}
    for r in scraped_results:
        if not r.get("headlines"):
            continue
        cats = r["headlines"][0].get("categorization", {})
        label = topic = title_en = None
        for p in _PROVIDERS:
            c = cats.get(p) or {}
            if label is None and c.get("label"):
                label = c["label"]
            if topic is None and c.get("topic"):
                topic = c["topic"]
            if title_en is None and c.get("title_en"):
                title_en = c["title_en"]
        countries[r["country_code"]] = {"label": label, "topic": topic, "title_en": title_en}
    return {"run_ts": run_ts, "countries": countries}


def _fetch_s3_history(bucket: str, key: str) -> list:
    """Read the existing history array from the current S3 latest.json."""
    try:
        import boto3
        s3 = boto3.client("s3")
        obj = s3.get_object(Bucket=bucket, Key=key)
        data = json.loads(obj["Body"].read())
        return data.get("history", [])
    except Exception as e:
        logger.debug("Could not fetch existing history from s3://%s/%s: %s", bucket, key, e)
        return []


def upload_to_s3(filepath: Path, bucket: str, key: str) -> bool:
    """Upload a file to S3. Returns True on success, False on failure."""
    try:
        import boto3
        s3 = boto3.client("s3")
        s3.upload_file(
            str(filepath),
            bucket,
            key,
            ExtraArgs={"ContentType": "application/json"},
        )
        logger.info("Uploaded to s3://%s/%s", bucket, key)
        return True
    except Exception as e:
        logger.warning("S3 upload failed: %s", e)
        return False

OUTPUT_DIR = Path(__file__).parent / "output"


def save_results(
    scraped_results: list[dict],
    clusters: list[dict],
    run_metadata: dict,
    output_dir: Path = OUTPUT_DIR,
) -> Path:
    """
    Persist a full run's results to a timestamped JSON file.

    The output schema:
    {
        "run_metadata": { ... },
        "countries": [ ... ],      # enriched scraper results
        "clusters": [ ... ],       # topic clusters (empty if embeddings disabled)
    }

    Returns the path to the written file.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"results_{ts}.json"
    filepath = output_dir / filename

    import config as _config

    run_ts = run_metadata.get("run_started_at", datetime.now(timezone.utc).isoformat())

    # Fetch existing history from S3 before overwriting
    if _config.S3_ENABLED and _config.S3_BUCKET:
        old_history = _fetch_s3_history(_config.S3_BUCKET, _config.S3_KEY)
    else:
        old_history = []

    snapshot = _build_snapshot(scraped_results, run_ts)
    history = (old_history + [snapshot])[-_MAX_HISTORY:]

    payload = {
        "run_metadata": {
            **run_metadata,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "total_countries": len(scraped_results),
            "countries_with_headlines": sum(
                1 for r in scraped_results if r.get("headlines")
            ),
            "countries_with_errors": sum(
                1 for r in scraped_results if r.get("error")
            ),
            "total_clusters": len(clusters),
        },
        "countries": scraped_results,
        "clusters": clusters,
        "history": history,
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    logger.info("Saved results to %s", filepath)

    # Maintain a latest.json for easy access
    latest_path = output_dir / "latest.json"
    shutil.copy2(filepath, latest_path)
    logger.info("Updated %s", latest_path)

    # Upload to S3 if configured
    if _config.S3_ENABLED and _config.S3_BUCKET:
        upload_to_s3(latest_path, _config.S3_BUCKET, _config.S3_KEY)

    return filepath


def load_latest(output_dir: Path = OUTPUT_DIR) -> dict | None:
    """Load the most recent results file, or None if none exist."""
    latest = output_dir / "latest.json"
    if latest.exists():
        with open(latest, encoding="utf-8") as f:
            return json.load(f)

    # Fallback: find most recent by filename
    files = sorted(output_dir.glob("results_*.json"), reverse=True)
    if not files:
        return None
    with open(files[0], encoding="utf-8") as f:
        return json.load(f)


def list_runs(output_dir: Path = OUTPUT_DIR) -> list[Path]:
    """Return all result files sorted newest-first."""
    return sorted(output_dir.glob("results_*.json"), reverse=True)
