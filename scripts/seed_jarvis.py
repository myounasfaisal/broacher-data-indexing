#!/usr/bin/env python3
"""
Create the Jarvis service account in Supabase and assign it the 'viewer' role.

Viewer = read-only access (search, listing detail, suggestions, dashboard).
No upload, no edit, no delete, no user management.

Usage:
    python scripts/seed_jarvis.py

Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, and SUPABASE_ANON_KEY in
backend/.env (or as environment variables).

Prints the initial credentials and a ready-to-use curl command so the client
can verify the account works immediately.
"""

import os
import secrets
import string
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Load backend/.env so the script works from the repo root.
_backend_env = Path(__file__).resolve().parent.parent / "backend" / ".env"
if _backend_env.exists():
    load_dotenv(_backend_env)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")

JARVIS_EMAIL = "jarvis@brochure-app.net"


def _generate_password(length: int = 32) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%&*"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def main() -> None:
    if not SUPABASE_URL or not SERVICE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        print("       Make sure backend/.env exists and has them filled in.")
        sys.exit(1)

    password = _generate_password()

    # --- 1. Create the user via Admin Auth API ---
    print(f"Creating Jarvis service account ({JARVIS_EMAIL})…")
    resp = httpx.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "email": JARVIS_EMAIL,
            "password": password,
            "email_confirm": True,
        },
        timeout=15,
    )

    if resp.status_code in (200, 201):
        user_id = resp.json().get("id")
        print(f"  [OK] Created. User ID: {user_id}")
    elif resp.status_code == 422 and "already" in resp.text.lower():
        print("  [i]  Account already exists — updating password instead.")
        # Look up the existing user id.
        list_resp = httpx.get(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
            },
            timeout=15,
        )
        user_id = None
        if list_resp.status_code == 200:
            for u in list_resp.json().get("users", []):
                if u.get("email") == JARVIS_EMAIL:
                    user_id = u["id"]
                    break
        if not user_id:
            print("  [X] Could not find existing user id. Aborting.")
            sys.exit(1)
        # Update password.
        httpx.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SERVICE_KEY,
                "Authorization": f"Bearer {SERVICE_KEY}",
                "Content-Type": "application/json",
            },
            json={"password": password},
            timeout=15,
        )
        print(f"  [OK] Password reset. User ID: {user_id}")
    else:
        print(f"  [X] Failed: {resp.status_code}  {resp.text[:300]}")
        sys.exit(1)

    # --- 2. Set role to 'viewer' in the profiles table ---
    print("  Setting role to 'viewer'…")
    role_resp = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/profiles",
        params={"id": f"eq.{user_id}"},
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={"role": "viewer"},
        timeout=10,
    )
    if role_resp.status_code in (200, 204):
        print("  [OK] Role set to 'viewer' (read-only).")
    else:
        print(f"  [!] Role update returned {role_resp.status_code}: {role_resp.text[:200]}")
        print("       The account exists but may have a different role.")

    # --- 3. Print results ---
    print("\n" + "=" * 60)
    print("JARVIS SERVICE ACCOUNT CREDENTIALS")
    print("=" * 60)
    print(f"  Email:    {JARVIS_EMAIL}")
    print(f"  Password: {password}")
    print(f"  Role:     viewer (search + view only)")
    print("=" * 60)
    print("\nStore these securely. The password is NOT recoverable.\n")

    # --- 4. Print example usage ---
    print("--- Quick test (replace BACKEND_URL with your deployed address) ---\n")
    print(f"""# 1. Get tokens
curl -X POST BACKEND_URL/auth/token \\
  -H 'Content-Type: application/json' \\
  -d '{{"email": "{JARVIS_EMAIL}", "password": "<password>"}}'

# 2. Search products (use access_token from step 1)
curl BACKEND_URL/search?q=sodium \\
  -H 'Authorization: Bearer <access_token>'

# 3. When the token expires (~1 hour), refresh it
curl -X POST BACKEND_URL/auth/refresh \\
  -H 'Content-Type: application/json' \\
  -d '{{"refresh_token": "<refresh_token>"}}'
""")


if __name__ == "__main__":
    main()
