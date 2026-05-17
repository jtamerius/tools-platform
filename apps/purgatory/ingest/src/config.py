"""Ingest Lambda configuration — env vars and constants."""
from __future__ import annotations
import os

S3_BUCKET = os.environ["S3_BUCKET"]
INGEST_TABLE = os.environ["INGEST_TABLE"]
CAM_CONFIG_TABLE = os.environ["CAM_CONFIG_TABLE"]
AGENT_COUNTER_TABLE = os.environ["AGENT_COUNTER_TABLE"]

RWIS_STATION_ID = os.environ.get("RWIS_STATION_ID", "374")
RWIS_PARTNER_CAM = os.environ.get("RWIS_PARTNER_CAM", "952-N")
COTRIP_GRAPHQL_URL = "https://www.cotrip.org/api/graphql"

YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "/var/task/yolov8n.pt")
YOLO_CONFIDENCE = float(os.environ.get("YOLO_CONFIDENCE", "0.25"))
YOLO_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
MODEL_S3_PREFIX = "models/"
YOLO_DEFAULT_INFERENCE = {"conf": 0.25, "iou": 0.45, "agnostic_nms": True, "max_det": 50}

AGENT_PROMPT_VERSION = os.environ.get("AGENT_PROMPT_VERSION", "v1")
AGENT_MONTHLY_CAP = int(os.environ.get("AGENT_MONTHLY_CAP", "200"))
AGENT_TIER1_CONFIDENCE_THRESHOLD = 0.85
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-haiku-4-5-20251001-v1:0")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")

FLAG_VISIBILITY_MILES = 0.5
FLAG_YOLO_CONFIDENCE_MIN = 0.4
FLAG_COUNT_STDDEV = 2.0

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
