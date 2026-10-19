#!/usr/bin/env python3
"""Operator-authorized synthetic Cognito identity only; no DB/role/scope writes."""
import getpass
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import sys

ACCOUNT = "676101350279"
REGION = "us-east-1"
POOL = "us-east-1_WzzG10dCP"
EMAIL = "advisor-preview-83@advisor.example.com"
MARKER = "CO-ED synthetic Advisor smoke 83"
IDENTITY_FILE = "coed-advisor83-identity.json"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def valid_password(value):
    return (12 <= len(value) <= 128 and not re.search(r"\s", value)
            and re.search(r"[A-Z]", value) and re.search(r"[a-z]", value)
            and re.search(r"[0-9]", value) and re.search(r"[^A-Za-z0-9\s]", value))


def attrs(user):
    return {item["Name"]: item["Value"] for item in user.get("UserAttributes", [])}


def expected_identity(user):
    value = attrs(user)
    require(value.get("email") == EMAIL and value.get("name") == MARKER,
            "Existing Cognito user does not have the exact test marker; no reset allowed.")
    require(value.get("email_verified") == "true", "Unexpected email verification state.")
    require(user.get("Enabled") is True, "Existing test user is disabled; no activation allowed.")
    require(user.get("UserStatus") in {"FORCE_CHANGE_PASSWORD", "CONFIRMED"},
            "Unexpected test-user status; stop for operator review.")
    subject = value.get("sub", "")
    require(bool(re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", subject)),
            "Missing or invalid synthetic subject.")
    return subject


def provision(client_for, prompt, output_path, interactive):
    require(interactive, "Run in an interactive CloudShell terminal; never pipe passwords.")
    require(client_for("sts").get_caller_identity()["Account"] == ACCOUNT, "Wrong AWS account.")
    cognito = client_for("cognito-idp")
    require(cognito.describe_user_pool(UserPoolId=POOL)["UserPool"]["Id"] == POOL, "Wrong User Pool.")
    user = None
    try:
        user = cognito.admin_get_user(UserPoolId=POOL, Username=EMAIL)
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") != "UserNotFoundException":
            raise
    if user is not None:
        expected_identity(user)

    previous = None
    if output_path.exists():
        require(not output_path.is_symlink() and output_path.is_file(), "Unexpected identity-file target.")
        require(output_path.stat().st_mode & 0o077 == 0, "Identity metadata must have mode 0600.")
        previous = json.loads(output_path.read_text(encoding="utf-8"))
        require(user is not None and previous.get("email") == EMAIL
                and previous.get("user_pool_id") == POOL
                and previous.get("sub") == expected_identity(user),
                "Existing identity file is not this synthetic user; no overwrite allowed.")
        require(previous == {"email": EMAIL, "user_pool_id": POOL, "username": user["Username"],
                             "sub": expected_identity(user),
                             "issuer": "https://cognito-idp.us-east-1.amazonaws.com/" + POOL,
                             "fixture_marker": MARKER},
                "Unexpected identity metadata; no account/password change allowed.")

    print("Create/resume ONE owner-authorized synthetic Advisor test identity; no invitation is sent.")
    print("Email: " + EMAIL)
    if user is not None:
        print("Exact marked test identity exists: reset its test password only; no role is changed.")
    print("Choose a NEW test password: 12-128 characters, uppercase/lowercase/digit/symbol; no spaces.")
    password = prompt("Advisor test password (hidden): ")
    confirmation = prompt("Confirm password (hidden): ")
    require(password == confirmation and valid_password(password),
            "Passwords did not match or policy was not met. No account/password change was made.")
    if user is None:
        cognito.admin_create_user(
            UserPoolId=POOL, Username=EMAIL, MessageAction="SUPPRESS",
            TemporaryPassword=password,
            UserAttributes=[{"Name": "email", "Value": EMAIL},
                            {"Name": "email_verified", "Value": "true"},
                            {"Name": "name", "Value": MARKER}])
        user = cognito.admin_get_user(UserPoolId=POOL, Username=EMAIL)
        expected_identity(user)
    username = user["Username"]
    cognito.admin_set_user_password(UserPoolId=POOL, Username=username, Password=password, Permanent=True)
    user = cognito.admin_get_user(UserPoolId=POOL, Username=username)
    subject = expected_identity(user)
    require(user["UserStatus"] == "CONFIRMED", "Password step did not confirm the test identity.")
    identity = {"email": EMAIL, "user_pool_id": POOL, "username": username,
                "sub": subject, "issuer": "https://cognito-idp.us-east-1.amazonaws.com/" + POOL,
                "fixture_marker": MARKER}
    if previous is None:
        descriptor = os.open(output_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(identity, handle, indent=2)
            handle.write("\n")
    else:
        require(previous == identity, "Identity changed unexpectedly; metadata was not overwritten.")
    print(json.dumps({"LoginEmail": EMAIL, "Status": user["UserStatus"],
                      "PrivateIdentityFile": str(output_path),
                      "IdentityFileSha256": hashlib.sha256(output_path.read_bytes()).hexdigest()}, indent=2))
    print("COGNITO ONLY VERIFIED; internal Advisor link, limited assignment and isolated DB fixtures are still pending.")
    print("Identity file contains a synthetic subject, NOT a password/token. Keep it private; do not commit or post it.")


def main():
    import boto3
    from botocore.config import Config
    logging.getLogger().setLevel(logging.CRITICAL)
    session = boto3.Session(region_name=REGION)
    config = Config(connect_timeout=5, read_timeout=15, retries={"total_max_attempts": 2})
    provision(lambda service: session.client(service, config=config), getpass.getpass,
              Path(IDENTITY_FILE).resolve(), sys.stdin.isatty() and sys.stderr.isatty())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("STOP: interrupted; no credential printed.", file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        code = getattr(error, "response", {}).get("Error", {}).get("Code")
        if code and re.fullmatch(r"[A-Za-z0-9_]+", str(code)):
            print("STOP: AWS operation failed (" + code + "). No credential printed; report this code.", file=sys.stderr)
        elif isinstance(error, RuntimeError):
            print("STOP: " + str(error), file=sys.stderr)
        else:
            print("STOP: " + type(error).__name__ + "; no exception details/credentials printed.", file=sys.stderr)
        print("A marked Cognito user may exist if an AWS step partially completed; do not delete/recreate it. Resume with this helper only.", file=sys.stderr)
        sys.exit(1)
