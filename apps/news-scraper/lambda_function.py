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

# Set all configuration BEFORE any scraper imports so config.py
# reads the correct values on first import (Lambda cold start).
os.environ["GROQ_ENABLED"]       = "false"
os.environ["GEMINI_ENABLED"]     = "false"
os.environ["HF_ENABLED"]         = "false"
os.environ["OPENROUTER_ENABLED"] = "false"
os.environ["BEDROCK_ENABLED"]    = "true"
os.environ["MAX_CONCURRENT_LLM"] = "100"
os.environ["ENABLE_EMBEDDINGS"]  = "false"
os.environ["S3_ENABLED"]         = "true"
os.environ["S3_BUCKET"]          = os.environ.get("S3_BUCKET", "jtamerius-news-data")
os.environ["S3_KEY"]             = os.environ.get("S3_KEY", "latest.json")
os.environ["OUTPUT_DIR"]         = "/tmp/news-output"

# Now safe to import scraper modules
import main as scraper_main  # noqa: E402
import argparse               # noqa: E402

# Lambda pre-configures root logger; set level directly rather than calling basicConfig
logging.getLogger().setLevel(logging.INFO)
logger = logging.getLogger("lambda_handler")

SSM_REGION = os.environ.get("AWS_REGION", "us-east-1")


def _get_ssm(name: str) -> str:
    ssm = boto3.client("ssm", region_name=SSM_REGION)
    return ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]


def handler(event, context):
    logger.info("News scraper Lambda starting")

    # Pull LLM API keys from SSM (best-effort — Bedrock doesn't need one)
    for env_var, ssm_path in {
        "GROQ_API_KEY":       "/tools/news-scraper/groq-api-key",
        "GEMINI_API_KEY":     "/tools/news-scraper/gemini-api-key",
        "HF_API_KEY":         "/tools/news-scraper/hf-api-key",
        "OPENROUTER_API_KEY": "/tools/news-scraper/openrouter-api-key",
    }.items():
        try:
            os.environ[env_var] = _get_ssm(ssm_path)
        except Exception as e:
            logger.debug("Skipping %s: %s", ssm_path, e)

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
