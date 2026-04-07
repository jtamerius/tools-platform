"""
Central configuration for the news scraper.

All values can be overridden via environment variables (loaded from .env).
"""

import os
from dotenv import load_dotenv

load_dotenv()


def _bool(key: str, default: bool) -> bool:
    val = os.environ.get(key, "").strip().lower()
    if val in ("1", "true", "yes"):
        return True
    if val in ("0", "false", "no"):
        return False
    return default


def _int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except ValueError:
        return default


def _float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# Scraping
# ---------------------------------------------------------------------------

# Number of top headlines to fetch per country (minimum 1)
TOP_N_HEADLINES: int = max(1, _int("TOP_N_HEADLINES", 1))

# ---------------------------------------------------------------------------
# LLM providers
# Each entry: enabled flag + model name + env var holding the API key
# ---------------------------------------------------------------------------

LLM_PROVIDERS: dict = {
    "groq": {
        "enabled": _bool("GROQ_ENABLED", True),
        "model": os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile"),
        "api_key_env": "GROQ_API_KEY",
    },
    "gemini": {
        "enabled": _bool("GEMINI_ENABLED", True),
        "model": os.environ.get("GEMINI_MODEL", "gemini-2.0-flash"),
        "api_key_env": "GEMINI_API_KEY",
    },
    "huggingface": {
        "enabled": _bool("HF_ENABLED", True),
        "model": os.environ.get("HF_MODEL", "mistralai/Mistral-7B-Instruct-v0.3"),
        "api_key_env": "HF_API_KEY",
    },
    "openrouter": {
        "enabled": _bool("OPENROUTER_ENABLED", True),
        "model": os.environ.get("OPENROUTER_MODEL", "meta-llama/llama-3.2-3b-instruct:free"),
        "api_key_env": "OPENROUTER_API_KEY",
    },
}

# Max concurrent LLM requests (across all providers combined)
MAX_CONCURRENT_LLM: int = _int("MAX_CONCURRENT_LLM", 5)

# ---------------------------------------------------------------------------
# Embeddings / clustering (optional)
# ---------------------------------------------------------------------------

ENABLE_EMBEDDINGS: bool = _bool("ENABLE_EMBEDDINGS", True)

# HuggingFace sentence-transformer model for embeddings
EMBEDDING_MODEL: str = os.environ.get(
    "EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
)

# HF API key (re-uses HF_API_KEY if not separately set)
EMBEDDING_API_KEY_ENV: str = "HF_API_KEY"

# Cosine similarity threshold for grouping headlines as "same topic" (0–1)
SIMILARITY_THRESHOLD: float = _float("SIMILARITY_THRESHOLD", 0.65)

# Whether to store raw embedding vectors in the output JSON (can be large)
STORE_EMBEDDINGS: bool = _bool("STORE_EMBEDDINGS", False)

# How many headline texts to send per HF embedding API call
EMBEDDING_BATCH_SIZE: int = _int("EMBEDDING_BATCH_SIZE", 64)

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

# Directory for JSON output files (relative to this file)
OUTPUT_DIR: str = os.environ.get("OUTPUT_DIR", "output")
