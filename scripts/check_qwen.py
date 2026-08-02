"""Quick sanity check for the Qwen (DashScope international) API key."""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

api_key = os.getenv("qwen_api") or os.getenv("QWEN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
if not api_key:
    print("No qwen_api key found in .env")
    sys.exit(1)

client = OpenAI(
    api_key=api_key,
    base_url="https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
)

try:
    resp = client.chat.completions.create(
        model="qwen-plus",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Reply with exactly: pong"},
        ],
        max_tokens=16,
    )
    print("OK:", resp.choices[0].message.content)
    print("model:", resp.model, "| usage:", resp.usage)
except Exception as e:
    print("FAILED:", type(e).__name__, e)
    sys.exit(2)
