"""AI provider wrapper. Uses OpenAI (ChatGPT) for generation with JSON schema validation."""
import json
import os
import re
from pathlib import Path
from typing import Optional, Type, TypeVar

from dotenv import load_dotenv
from pydantic import BaseModel, ValidationError

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

T = TypeVar("T", bound=BaseModel)

MODEL = (
    os.getenv("OPENAI_MODEL")
    or os.getenv("CHATGPT_MODEL")
    or "gpt-4o-mini"
)
API_KEY = (
    os.getenv("OPENAI_API_KEY")
    or os.getenv("CHATGPT_API_KEY")
    or os.getenv("ANTHROPIC_API_KEY")
    or ""
).strip()

# True -> real AI. False -> clearly labelled DEMO mode (heuristics + local question bank).
AI_ENABLED = bool(API_KEY)

_client = None


def _get_client():
    global _client
    if _client is None:
        import openai

        _client = openai.OpenAI(api_key=API_KEY, timeout=60.0, max_retries=2)
    return _client


class AIError(Exception):
    """Raised when the AI call fails or returns something we cannot validate."""


def _extract_json(text: str) -> dict:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object found")
    return json.loads(text[start : end + 1])


def generate_json(system: str, user: str, schema: Type[T], max_tokens: int = 4000) -> T:
    """Call the OpenAI model, parse its JSON reply and validate it against `schema` (one retry on bad output)."""
    import openai

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
    last_err: Optional[Exception] = None
    for _ in range(2):
        try:
            resp = _get_client().chat.completions.create(
                model=MODEL,
                messages=messages,
                response_format={"type": "json_object"},
                max_tokens=max_tokens,
            )
        except openai.AuthenticationError as e:
            raise AIError("The OpenAI API key was rejected. Check OPENAI_API_KEY in .env.") from e
        except openai.RateLimitError as e:
            raise AIError("The AI service is rate-limited right now. Please retry in a few seconds.") from e
        except openai.APIConnectionError as e:
            raise AIError("Could not reach the AI service. Check your internet connection.") from e
        except openai.APIStatusError as e:
            raise AIError(f"The AI service returned an error ({e.status_code}): {getattr(e, 'message', str(e))}") from e

        choice = resp.choices[0] if resp.choices else None
        if not choice:
            raise AIError("The AI returned an empty response.")

        text = choice.message.content or ""
        try:
            return schema.model_validate(_extract_json(text))
        except (ValueError, ValidationError) as e:
            last_err = e
            messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
                {"role": "assistant", "content": text or "{}"},
                {
                    "role": "user",
                    "content": "That reply was not valid for the required JSON schema "
                    f"({str(e)[:300]}). Reply again with ONLY the corrected JSON object.",
                },
            ]
    raise AIError("The AI returned an invalid response. Please try again.") from last_err
