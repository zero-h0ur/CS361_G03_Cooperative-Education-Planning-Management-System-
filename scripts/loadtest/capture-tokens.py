#!/usr/bin/env python3
"""Capture Cognito Hosted UI OAuth2 refresh & access tokens for load-test users.

Cognito InitiateAuth does not issue the custom `coed-api/access` scope, so this
script logs each user in through the Cognito Hosted UI Authorization Code + PKCE
flow using Playwright, intercepts the callback redirect before the frontend
consumes the authorization code, and exchanges the code at `/oauth2/token`.

Tokens are written to `scripts/loadtest/tokens.json` (gitignored).
"""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import getpass
import hashlib
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_DOMAIN = "coed-v4-130165494095.auth.ap-southeast-2.amazoncognito.com"
DEFAULT_CLIENT_ID = "65b8bifg3860706esa1uns6cd8"
DEFAULT_REDIRECT_URI = "https://main.d1bpmj87vmjb96.amplifyapp.com/app.html"
DEFAULT_SCOPES = "openid email coed-api/access"
REQUIRED_SCOPE = "coed-api/access"
DEFAULT_EMAIL_DOMAIN = "loadtest.coed.local"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "tokens.json"


def make_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def decode_jwt_payload(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT format")
    payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
    return json.loads(base64.urlsafe_b64decode(payload_b64).decode("utf-8"))


def exchange_code_for_tokens(
    *,
    domain: str,
    client_id: str,
    redirect_uri: str,
    code: str,
    code_verifier: str,
) -> dict:
    token_url = f"https://{domain}/oauth2/token"
    body = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": code_verifier,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        token_url,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Token exchange failed ({err.code}): {detail}") from err


def capture_user_token(
    *,
    browser,
    domain: str,
    client_id: str,
    redirect_uri: str,
    scopes: str,
    username: str,
    password: str,
    timeout_ms: int,
) -> dict:
    code_verifier, code_challenge = make_pkce_pair()
    state = secrets.token_urlsafe(24)

    auth_params = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "response_type": "code",
            "scope": scopes,
            "redirect_uri": redirect_uri,
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "prompt": "login",
        }
    )
    authorize_url = f"https://{domain}/oauth2/authorize?{auth_params}"

    captured: dict[str, str] = {}
    context = browser.new_context()
    page = context.new_page()
    page.set_default_timeout(timeout_ms)

    def check_url(url: str) -> None:
        if captured or not url.startswith(redirect_uri):
            return
        parsed = urllib.parse.urlparse(url)
        query = urllib.parse.parse_qs(parsed.query)
        if "code" in query:
            captured["code"] = query["code"][0]
            captured["state"] = query.get("state", [""])[0]
        elif "error" in query:
            captured["error"] = query["error"][0]
            captured["error_description"] = query.get("error_description", [""])[0]

    # Playwright page.route() does not always intercept 302 redirect targets in Chromium.
    # Block the frontend bundle so Amplify cannot consume the one-time `code`, and
    # capture `code` from both request events and `page.url`.
    page.route("**/assets/authenticated-shell.js*", lambda route: route.abort())
    page.on("request", lambda req: check_url(req.url))

    try:
        page.goto(authorize_url, wait_until="domcontentloaded")

        # Cognito Classic Hosted UI renders both mobile (.visible-xs) and desktop (.visible-lg)
        # forms in the DOM; `:visible` targets the active one. Managed Login uses single inputs.
        username_locator = page.locator(
            'input[name="username"]:visible, input[id="username"]:visible, input[type="text"]:visible'
        ).first
        username_locator.wait_for(state="visible")
        username_locator.fill(username)

        password_locator = page.locator(
            'input[name="password"]:visible, input[id="password"]:visible, input[type="password"]:visible'
        ).first

        # Managed Login v2 may ask for username first, then password on the next step.
        if password_locator.count() == 0 or not password_locator.is_visible():
            next_btn = page.locator(
                'button[type="submit"]:visible, input[type="submit"]:visible'
            ).first
            next_btn.click()
            password_locator.wait_for(state="visible")

        password_locator.fill(password)

        submit_locator = page.locator(
            'input[name="signInSubmitButton"]:visible, button[type="submit"]:visible, input[type="submit"]:visible'
        ).first
        submit_locator.click()

        # Wait until callback captures `code` or `error`
        deadline_seconds = timeout_ms / 1000.0
        elapsed = 0.0
        while not captured and elapsed < deadline_seconds:
            check_url(page.url)
            if captured:
                break
            page.wait_for_timeout(150)
            elapsed += 0.15

        if "error" in captured:
            raise RuntimeError(
                f"OAuth error for {username}: {captured['error']} "
                f"({captured.get('error_description', '')})"
            )
        if "code" not in captured:
            raise RuntimeError(
                f"Timed out waiting for OAuth callback for {username} "
                f"(current URL: {page.url}). Check username/password or run with --headful."
            )
        if captured.get("state") != state:
            raise RuntimeError(f"OAuth state mismatch for {username}")
    finally:
        context.close()

    token_response = exchange_code_for_tokens(
        domain=domain,
        client_id=client_id,
        redirect_uri=redirect_uri,
        code=captured["code"],
        code_verifier=code_verifier,
    )

    access_token = token_response.get("access_token", "")
    refresh_token = token_response.get("refresh_token", "")
    if not access_token or not refresh_token:
        raise RuntimeError(f"Missing access_token or refresh_token in response for {username}")

    claims = decode_jwt_payload(access_token)
    granted_scopes = str(claims.get("scope", "")).split()
    if REQUIRED_SCOPE not in granted_scopes:
        raise RuntimeError(
            f"Access token for {username} is missing required scope '{REQUIRED_SCOPE}' "
            f"(got: {claims.get('scope', '')})"
        )

    now_iso = dt.datetime.now(dt.timezone.utc).isoformat()
    return {
        "username": username,
        "sub": claims.get("sub"),
        "refresh_token": refresh_token,
        "access_token": access_token,
        "token_type": token_response.get("token_type", "Bearer"),
        "expires_in": token_response.get("expires_in", 3600),
        "exp": claims.get("exp"),
        "scope": claims.get("scope", ""),
        "obtained_at": now_iso,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Capture Cognito Hosted UI refresh tokens into tokens.json"
    )
    parser.add_argument(
        "--users",
        default=",".join(f"loadtest{i:02d}@{DEFAULT_EMAIL_DOMAIN}" for i in range(1, 11)),
        help="Comma-separated usernames/emails (default: loadtest01..loadtest10@loadtest.coed.local)",
    )
    parser.add_argument("--domain", default=DEFAULT_DOMAIN, help="Cognito Hosted UI domain")
    parser.add_argument("--client-id", default=DEFAULT_CLIENT_ID, help="Cognito App Client ID")
    parser.add_argument("--redirect-uri", default=DEFAULT_REDIRECT_URI, help="OAuth callback URL")
    parser.add_argument("--scopes", default=DEFAULT_SCOPES, help="Space-separated OAuth scopes")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"Output JSON path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--merge",
        action="store_true",
        help="Merge/update into existing output JSON instead of overwriting",
    )
    parser.add_argument(
        "--headful",
        action="store_true",
        help="Show browser window while logging in",
    )
    parser.add_argument(
        "--timeout-ms",
        type=int,
        default=20000,
        help="Playwright wait timeout per step in milliseconds (default: 20000)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    usernames = [
        u.strip() if "@" in u else f"{u.strip()}@{DEFAULT_EMAIL_DOMAIN}"
        for u in args.users.split(",")
        if u.strip()
    ]
    if not usernames:
        print("Error: --users must contain at least one username.", file=sys.stderr)
        return 1

    password = os.environ.get("LOADTEST_PASSWORD", "")
    if not password:
        password = getpass.getpass(f"Password for {', '.join(usernames)}: ")
    if not password:
        print("Error: password cannot be empty.", file=sys.stderr)
        return 1

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Error: playwright is not installed.\n"
            "Install with:\n"
            "  pip install playwright && playwright install chromium",
            file=sys.stderr,
        )
        return 1

    existing_by_user: dict[str, dict] = {}
    if args.merge and args.output.exists():
        try:
            existing_data = json.loads(args.output.read_text(encoding="utf-8"))
            for item in existing_data.get("accounts", []):
                if isinstance(item, dict) and item.get("username"):
                    existing_by_user[item["username"]] = item
        except (OSError, json.JSONDecodeError):
            pass

    results: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headful)
        try:
            for username in usernames:
                entry = capture_user_token(
                    browser=browser,
                    domain=args.domain,
                    client_id=args.client_id,
                    redirect_uri=args.redirect_uri,
                    scopes=args.scopes,
                    username=username,
                    password=password,
                    timeout_ms=args.timeout_ms,
                )
                existing_by_user[username] = entry
                results.append(entry)
                print(
                    f"[OK] {username} sub={entry['sub']} "
                    f"scope=\"{entry['scope']}\" expires_in={entry['expires_in']}s"
                )
        finally:
            browser.close()

    accounts = list(existing_by_user.values()) if args.merge else results
    payload = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "token_endpoint": f"https://{args.domain}/oauth2/token",
        "client_id": args.client_id,
        "accounts": accounts,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = args.output.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp_path, 0o600)
    tmp_path.replace(args.output)

    print(f"\nSaved {len(accounts)} account token(s) to {args.output} (mode 0600).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
