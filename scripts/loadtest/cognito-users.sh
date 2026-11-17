#!/usr/bin/env bash
set -euo pipefail

# Manage synthetic load-test Cognito users (loadtest01..loadtest10)
# in User Pool ap-southeast-2_Um6nksXa1.
#
# Usage:
#   ./scripts/loadtest/cognito-users.sh create [--count 10]
#   ./scripts/loadtest/cognito-users.sh list   [--count 10]
#   ./scripts/loadtest/cognito-users.sh delete [--count 10]
#
# Password for `create` is read from LOADTEST_PASSWORD env var or prompted
# securely (never hardcoded or printed).

POOL_ID="${COGNITO_USER_POOL_ID:-ap-southeast-2_Um6nksXa1}"
REGION="${AWS_REGION:-ap-southeast-2}"
PREFIX="${LOADTEST_USER_PREFIX:-loadtest}"
EMAIL_DOMAIN="${LOADTEST_EMAIL_DOMAIN:-loadtest.coed.local}"
COUNT=10
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUBS_FILE="${SCRIPT_DIR}/loadtest-subs.json"

usage() {
  cat <<EOF
Usage: $(basename "$0") <create|list|delete> [--count N]

Commands:
  create   Create ${PREFIX}01..${PREFIX}NN with fake emails & permanent passwords, then print sub table
  list     Show existing ${PREFIX}01..${PREFIX}NN users and their Cognito sub
  delete   Delete ${PREFIX}01..${PREFIX}NN users from Cognito (run after class)

Options:
  --count N   Number of users (default: 10)
  -h, --help  Show this help
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

COMMAND="$1"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    --count)
      COUNT="${2:?--count requires a number}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_aws_auth() {
  if ! command -v aws >/dev/null 2>&1; then
    echo "Error: aws CLI not found." >&2
    exit 1
  fi
  if ! aws sts get-caller-identity --region "$REGION" >/dev/null 2>&1; then
    echo "Error: AWS CLI credentials are missing or expired. Run aws configure / aws sso login first." >&2
    exit 1
  fi
}

extract_sub() {
  python3 -c '
import json, sys
data = json.load(sys.stdin)
for attr in data.get("UserAttributes", data.get("Attributes", [])):
    if attr.get("Name") == "sub":
        print(attr.get("Value", ""))
        break
'
}

format_username() {
  printf "%s%02d@%s" "$PREFIX" "$1" "$EMAIL_DOMAIN"
}

cmd_create() {
  require_aws_auth

  local password="${LOADTEST_PASSWORD:-}"
  if [[ -z "$password" ]]; then
    read -rsp "Enter permanent password for ${PREFIX}01..$(format_username "$COUNT"): " password
    echo
    if [[ ${#password} -lt 8 ]]; then
      echo "Error: Password must be at least 8 characters." >&2
      exit 1
    fi
  fi

  local entries_json="["
  local first=true

  printf "%-32s %-38s %s\n" "USERNAME" "SUB" "STATUS"
  printf "%-32s %-38s %s\n" "--------------------------------" "--------------------------------------" "------"

  for ((i = 1; i <= COUNT; i++)); do
    local username status user_json sub
    username="$(format_username "$i")"

    if aws cognito-idp admin-get-user \
      --region "$REGION" \
      --user-pool-id "$POOL_ID" \
      --username "$username" >/dev/null 2>&1; then
      status="exists"
    else
      aws cognito-idp admin-create-user \
        --region "$REGION" \
        --user-pool-id "$POOL_ID" \
        --username "$username" \
        --user-attributes "Name=email,Value=${username}" "Name=email_verified,Value=true" \
        --message-action SUPPRESS >/dev/null
      status="created"
    fi

    aws cognito-idp admin-set-user-password \
      --region "$REGION" \
      --user-pool-id "$POOL_ID" \
      --username "$username" \
      --password "$password" \
      --permanent >/dev/null

    user_json="$(aws cognito-idp admin-get-user \
      --region "$REGION" \
      --user-pool-id "$POOL_ID" \
      --username "$username" \
      --output json)"
    sub="$(printf '%s' "$user_json" | extract_sub)"

    printf "%-32s %-38s %s\n" "$username" "$sub" "$status"

    if [[ "$first" == true ]]; then
      first=false
    else
      entries_json+=","
    fi
    entries_json+="{\"username\":\"${username}\",\"email\":\"${username}\",\"sub\":\"${sub}\"}"
  done

  entries_json+="]"
  python3 -c '
import json, sys
data = json.loads(sys.argv[1])
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump({"user_pool_id": sys.argv[3], "users": data}, f, indent=2)
    f.write("\n")
' "$entries_json" "$SUBS_FILE" "$POOL_ID"

  echo
  echo "Saved sub mapping (gitignored) to: $SUBS_FILE"
  echo "Send the 'sub' list to Ronnakrit, and send the password to Paphonphat via DM (not in group chat)."
}

cmd_list() {
  require_aws_auth

  printf "%-32s %-38s %-14s %s\n" "USERNAME" "SUB" "STATUS" "ENABLED"
  printf "%-32s %-38s %-14s %s\n" "--------------------------------" "--------------------------------------" "--------------" "-------"

  for ((i = 1; i <= COUNT; i++)); do
    local username user_json sub user_status enabled
    username="$(format_username "$i")"

    if user_json="$(aws cognito-idp admin-get-user \
      --region "$REGION" \
      --user-pool-id "$POOL_ID" \
      --username "$username" \
      --output json 2>/dev/null)"; then
      sub="$(printf '%s' "$user_json" | extract_sub)"
      user_status="$(printf '%s' "$user_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("UserStatus",""))')"
      enabled="$(printf '%s' "$user_json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("Enabled",""))')"
      printf "%-32s %-38s %-14s %s\n" "$username" "$sub" "$user_status" "$enabled"
    else
      printf "%-32s %-38s %-14s %s\n" "$username" "-" "NOT_FOUND" "-"
    fi
  done
}

cmd_delete() {
  require_aws_auth

  for ((i = 1; i <= COUNT; i++)); do
    local username
    username="$(format_username "$i")"

    if aws cognito-idp admin-get-user \
      --region "$REGION" \
      --user-pool-id "$POOL_ID" \
      --username "$username" >/dev/null 2>&1; then
      aws cognito-idp admin-delete-user \
        --region "$REGION" \
        --user-pool-id "$POOL_ID" \
        --username "$username" >/dev/null
      echo "Deleted: $username"
    else
      echo "Already absent: $username"
    fi
  done
}

case "$COMMAND" in
  create) cmd_create ;;
  list)   cmd_list ;;
  delete) cmd_delete ;;
  -h|--help) usage ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    usage
    exit 1
    ;;
esac
