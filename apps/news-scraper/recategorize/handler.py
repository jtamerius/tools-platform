"""
Recategorize Lambda — applies a user-defined AI prompt to the current
news headlines and returns per-country category overrides.

POST /recategorize
  Body: { "prompt": "...", "countries": [...] }  (countries from latest.json)
  Returns: { "recategorizations": { "US": "Iran-US War", "DE": null, ... } }
"""

import json
import os

import boto3

SYSTEM_PROMPT = """\
You are a news categorization assistant embedded in a global news dashboard \
that shows the top headline from roughly 100 countries every day.

Your job is to apply a user-specified grouping rule to a batch of headlines \
and return a category label for each headline that matches, or null for those \
that don't.

The user will give you a short instruction — a topic, theme, event, or pattern \
they want to highlight. They will NOT explain the objective or tell you what to \
do with it; you already know: scan the headlines, identify matches, and return \
the right label.

Guidelines:
- Infer a concise 2–4 word Title Case category label from the user's instruction. \
Do NOT copy the user's words literally — distill them into a clean label \
(e.g. user says "iran war or talks between iran and the US" → label is "Iran US War"; \
user says "economic crises" → label is "Economic Crisis")
- The label must be identical for every matching entry in this response
- Match semantically — a headline doesn't need to contain the user's exact words \
to be relevant; use judgment about meaning and context
- Be inclusive: if a headline is clearly about the same underlying story or theme, \
include it even if the wording differs
- For non-matching headlines, return null

Return ONLY a valid JSON object — no markdown, no explanation, nothing else:
{"COUNTRY_CODE": "Category Label", "COUNTRY_CODE": null, ...}
Every country code in the input must appear in the output.\
"""

MODEL_ID = 'amazon.nova-lite-v1:0'

_bedrock: boto3.client = None


def _get_bedrock():
    global _bedrock
    if _bedrock is None:
        _bedrock = boto3.client(
            'bedrock-runtime',
            region_name=os.environ.get('AWS_REGION', 'us-east-1'),
        )
    return _bedrock


def _extract_title(country: dict) -> str:
    h = (country.get('headlines') or [{}])[0]
    cats = h.get('categorization') or {}
    for p in ('groq', 'gemini', 'huggingface', 'openrouter'):
        t = (cats.get(p) or {}).get('title_en')
        if t:
            return t
    return h.get('title') or ''


def _call_nova(user_message: str) -> dict:
    body = json.dumps({
        'messages': [
            {'role': 'user', 'content': [{'text': user_message}]},
        ],
        'system': [{'text': SYSTEM_PROMPT}],
        'inferenceConfig': {
            'temperature': 0.1,
            'maxTokens': 1200,
        },
    })

    resp = _get_bedrock().invoke_model(
        modelId=MODEL_ID,
        contentType='application/json',
        accept='application/json',
        body=body,
    )
    data = json.loads(resp['body'].read())
    raw = data['output']['message']['content'][0]['text'].strip()

    # Strip markdown fences if the model wraps output anyway
    if raw.startswith('```'):
        raw = raw.split('```', 2)[1]
        if raw.startswith('json'):
            raw = raw[4:]
        raw = raw.strip()
    return json.loads(raw)


def _cors(status: int, body: dict) -> dict:
    return {
        'statusCode': status,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        'body': json.dumps(body),
    }


def handler(event: dict, _context) -> dict:
    # CORS preflight
    if event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
        return _cors(204, {})

    try:
        body = json.loads(event.get('body') or '{}')
    except (json.JSONDecodeError, TypeError):
        return _cors(400, {'error': 'Invalid JSON body'})

    user_prompt = (body.get('prompt') or '').strip()
    countries   = body.get('countries') or []

    if not user_prompt:
        return _cors(400, {'error': '"prompt" is required'})
    if not countries:
        return _cors(400, {'error': '"countries" is required'})

    # Build compact headline list — only what the LLM needs
    headlines = [
        {'code': c['country_code'], 'title': _extract_title(c)}
        for c in countries
        if c.get('country_code') and _extract_title(c)
    ]

    user_message = (
        f'User instruction: "{user_prompt}"\n\n'
        f'Headlines ({len(headlines)} countries):\n'
        + json.dumps(headlines, ensure_ascii=False)
        + '\n\nReturn JSON: {"COUNTRY_CODE": "Label" or null, ...}'
    )

    try:
        result = _call_nova(user_message)
    except Exception as exc:
        return _cors(502, {'error': str(exc)})

    return _cors(200, {'recategorizations': result})
