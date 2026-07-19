import httpx

SUPABASE_URL = "https://qpqdbyhfquqfrkrocnnu.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcWRieWhmcXVxZnJrcm9jbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMTkzODgsImV4cCI6MjA5OTU5NTM4OH0.zHHrkGYwE3mRbZ8EaFjtWGtAwACm2LCwnIaeE_JAsdA"

users_to_check = [
    {"email": "testadmin@brochure-app.net", "password": "password123"},
    {"email": "testviewer@brochure-app.net", "password": "password123"}
]

def check_sign_in(email, password):
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": ANON_KEY,
        "Content-Type": "application/json"
    }
    data = {
        "email": email,
        "password": password
    }
    
    try:
        response = httpx.post(url, headers=headers, json=data)
        if response.status_code == 200:
            res_data = response.json()
            user = res_data.get("user", {})
            print(f"SUCCESS: {email} can sign in! User ID: {user.get('id')}")
            return True
        else:
            print(f"FAILED: {email} cannot sign in. Status: {response.status_code}")
            print(response.text)
            return False
    except Exception as e:
        print(f"Error checking {email}: {e}")
        return False

if __name__ == "__main__":
    for user in users_to_check:
        check_sign_in(user["email"], user["password"])
