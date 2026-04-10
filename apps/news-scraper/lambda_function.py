"""
AWS Lambda handler for the news scraper.

Triggered by EventBridge on a daily schedule.
Reads LLM API keys from SSM Parameter Store and uploads results to S3.
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

import boto3

# Ensure the scraper package is on the path
sys.path.insert(0, str(Path(__file__).parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("lambda_handler")

SSM_REGION = os.environ.get("AWS_REGION", "us-east-1")
S3_BUCKET = os.environ.get("S3_BUCKET", "jtamerius-news-data")
S3_KEY = os.environ.get("S3_KEY", "latest.json")


def _get_ssm(name: str) -> str:
    ssm = boto3.client("ssm", region_name=SSM_REGION)
    return ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]


def handler(event, context):
    logger.info("News scraper Lambda starting")

    # Pull LLM keys from SSM and inject into environment
    providers = {
        "GROQ_API_KEY":       "/tools/news-scraper/groq-api-key",
        "GEMINI_API_KEY":     "/tools/news-scraper/gemini-api-key",
        "HF_API_KEY":         "/tools/news-scraper/hf-api-key",
        "OPENROUTER_API_KEY": "/tools/news-scraper/openrouter-api-key",
    }
    for env_var, ssm_path in providers.items():
        try:
            os.environ[env_var] = _get_ssm(ssm_path)
            logger.info("Loaded %s from SSM", env_var)
        except Exception as e:
            logger.warning("Could not load %s: %s", ssm_path, e)

    # Configure scraper via env
    os.environ.setdefault("GROQ_ENABLED", "true")
    os.environ.setdefault("GEMINI_ENABLED", "false")
    os.environ.setdefault("HF_ENABLED", "false")
    os.environ.setdefault("OPENROUTER_ENABLED", "false")
    os.environ.setdefault("MAX_CONCURRENT_LLM", "2")
    os.environ.setdefault("ENABLE_EMBEDDINGS", "false")
    os.environ["S3_ENABLED"] = "true"
    os.environ["S3_BUCKET"] = S3_BUCKET
    os.environ["S3_KEY"] = S3_KEY
    os.environ["OUTPUT_DIR"] = "/tmp/news-output"

    # Import after env is set so config.py picks up the values
    import config  # noqa: F401 — triggers dotenv load
    import importlib
    import main as scraper_main
    importlib.reload(scraper_main)

    import argparse
    args = argparse.Namespace(
        top_n=1,
        no_categorize=False,
        no_embed=True,
        countries=None,
        threshold=0.65,
        output_dir="/tmp/news-output",
    )

    asyncio.run(scraper_main.run(args))
    logger.info("News scraper Lambda complete")
    return {"status": "ok"}
