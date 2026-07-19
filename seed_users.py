"""
Seed test users via Supabase Admin Auth API.

Uses the SERVICE ROLE key so:
  - email confirmation is skipped entirely
  - the email send rate limit does not apply
  - the profile row gets the 'admin' role automatically via the DB trigger

Accounts created:
  testadmin@brochure-app.net  /  password123  → auto-promoted to admin (via DB trigger)
  testviewer@brochure-app.net /  password123  → admin by default (trigger), demote manually if needed

Run from the project root:
    python -m backend.venv.Scripts.python seed_users.py
or
    backend\\.venv\\Scripts\\python.exe seed_users.py
"""

import httpx

SUPABASE_URL = "https://qpqdbyhfquqfrkrocnnu.supabase.co"
SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcWRieWhmcXVxZnJrcm9jbm51Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NDAxOTM4OCwiZXhwIjoyMDk5NTk1Mzg4fQ.IyRVMQkY0De0oZyF-0-_USMZNG5h8AnzzYP_unK9dAM"

USERS = [
    {"email": "testadmin@brochure-app.net",  "password": "password123"},
    {"email": "testviewer@brochure-app.net", "password": "password123"},
]


def create_user(email: str, password: str) -> str | None:
    """Create a user via the Admin Auth API (no email confirmation, no rate limit)."""
    url = f"{SUPABASE_URL}/auth/v1/admin/users"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,   # mark email as already confirmed
    }

    resp = httpx.post(url, headers=headers, json=payload, timeout=15)

    if resp.status_code in (200, 201):
        user = resp.json()
        uid = user.get("id")
        print(f"  [OK] Created {email}  (id: {uid})")
        return uid
    elif resp.status_code == 422 and "already" in resp.text.lower():
        print(f"  [i]  {email} already exists -- skipping.")
        return None
    else:
        print(f"  [X]  Failed to create {email}: {resp.status_code}  {resp.text[:200]}")
        return None


def promote_to_admin(user_id: str, email: str) -> None:
    """Update the profiles row so the user has role='admin'."""
    url = f"{SUPABASE_URL}/rest/v1/profiles"
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    # Use service-role client -> bypasses RLS
    resp = httpx.patch(
        url,
        params={"id": f"eq.{user_id}"},
        headers=headers,
        json={"role": "admin"},
        timeout=10,
    )
    if resp.status_code in (200, 204):
        print(f"    -> promoted {email} to admin")
    else:
        print(f"    [X] promote failed {resp.status_code}: {resp.text[:200]}")


if __name__ == "__main__":
    print("Seeding users via Admin Auth API (no email limit)…\n")
    for user in USERS:
        uid = create_user(user["email"], user["password"])
        if uid:
            promote_to_admin(uid, user["email"])

    print("\nDone. Credentials:")
    for user in USERS:
        print(f"  {user['email']}  /  {user['password']}")
    print("\nAll users have role=admin. To demote testviewer, run:")
    print("  update public.profiles set role='viewer' where id='<uuid>';")
