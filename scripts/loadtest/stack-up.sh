#!/usr/bin/env bash
# สร้างระบบทดสอบสำหรับ load test: Lambda coed-api-loadtest + HTTP API coed-loadtest-api + CloudWatch dashboard
# ใช้โค้ดและค่าตั้งค่าเดียวกับ coed-api:live แต่ชี้ไปฐานข้อมูลทดสอบเท่านั้น ลบทั้งหมดด้วย stack-down.sh
#
# ต้องมี (ได้จากคนทำฐานทดสอบ):
#   TEST_DB_HOST        endpoint ของ RDS ทดสอบ
#   TEST_DB_SECRET_ARN  ARN ของ secret ฐานทดสอบ (JSON: engine, host, dbname, username, port, password)
# ไม่บังคับ:
#   TEST_DB_NAME (coed)  TEST_DB_USER (coed_app)  TEST_DB_PORT (5432)  TEST_DB_ID (coed-loadtest-db)
#   TEST_RESERVED_CONCURRENCY (ค่าเริ่มต้น = เท่ากับ coed-api ตัวจริง)
#   TEST_LAMBDA_SG  security group ของ Lambda ทดสอบ (ค่าเริ่มต้น = ใช้ตัวเดียวกับ coed-api ตัวจริง)
#                   ถ้าใช้ตัวใหม่ ต้องให้ VPC endpoint ของ Secrets Manager รับพอร์ต 443 จาก SG นี้ด้วย
#
# ใช้งาน:  aws login --profile coed-v4 --region ap-southeast-2
#          TEST_DB_HOST=... TEST_DB_SECRET_ARN=... bash scripts/loadtest/stack-up.sh
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-coed-v4}"
export AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
export AWS_PAGER=""

PROD_FN=coed-api
PROD_API_ID=yhfevhqtoa
FN=coed-api-loadtest
ROLE=coed-loadtest-lambda-role
API_NAME=coed-loadtest-api
DASHBOARD=coed-loadtest
EXPECTED_ACCOUNT=130165494095

: "${TEST_DB_HOST:?ต้องตั้ง TEST_DB_HOST}"
: "${TEST_DB_SECRET_ARN:?ต้องตั้ง TEST_DB_SECRET_ARN}"
TEST_DB_NAME="${TEST_DB_NAME:-coed}"
TEST_DB_USER="${TEST_DB_USER:-coed_app}"
TEST_DB_PORT="${TEST_DB_PORT:-5432}"
TEST_DB_ID="${TEST_DB_ID:-coed-loadtest-db}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$ROOT/tmp/loadtest"
mkdir -p "$WORK"
printf '*\n' > "$WORK/.gitignore"   # ไม่ให้ไฟล์ในโฟลเดอร์นี้ (config, token, state) หลุดเข้า git
STATE="$WORK/stack-state.env"

step() { printf '\n==> %s\n' "$*"; }
die() { printf 'หยุด: %s\n' "$*" >&2; exit 1; }

step "ตรวจบัญชี"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
[ "$ACCOUNT" = "$EXPECTED_ACCOUNT" ] || die "บัญชีคือ $ACCOUNT ไม่ใช่ $EXPECTED_ACCOUNT"
[ -f "$STATE" ] && die "มี $STATE อยู่แล้ว แปลว่าระบบทดสอบยังไม่ถูกลบ ให้รัน stack-down.sh ก่อน"
if aws lambda get-function --function-name "$FN" >/dev/null 2>&1; then die "มีฟังก์ชัน $FN อยู่แล้ว"; fi

step "อ่านค่าของ $PROD_FN:live"
aws lambda get-function-configuration --function-name "$PROD_FN" --qualifier live > "$WORK/prod-config.json"
PROD_RESERVED=$(aws lambda get-function-concurrency --function-name "$PROD_FN" --query ReservedConcurrentExecutions --output text)
RESERVED="${TEST_RESERVED_CONCURRENCY:-$PROD_RESERVED}"

python3 - "$WORK/prod-config.json" "$WORK" <<'PY'
import json, os, sys
cfg = json.load(open(sys.argv[1])); work = sys.argv[2]
env = dict(cfg.get("Environment", {}).get("Variables", {}))
if env.get("DB_HOST") == os.environ["TEST_DB_HOST"]:
    sys.exit("หยุด: TEST_DB_HOST ตรงกับฐานข้อมูลจริง")
if env.get("DB_SECRET_ARN") == os.environ["TEST_DB_SECRET_ARN"]:
    sys.exit("หยุด: TEST_DB_SECRET_ARN ตรงกับ secret ของจริง")
env.update({
    "DB_HOST": os.environ["TEST_DB_HOST"],
    "DB_SECRET_ARN": os.environ["TEST_DB_SECRET_ARN"],
    "DB_NAME": os.environ.get("TEST_DB_NAME", "coed"),
    "DB_USER": os.environ.get("TEST_DB_USER", "coed_app"),
    "DB_PORT": os.environ.get("TEST_DB_PORT", "5432"),
    "COED_API_MAINTENANCE": "off",
})
json.dump({"Variables": env}, open(f"{work}/env.json", "w"))
vpc = cfg["VpcConfig"]
open(f"{work}/fn.env", "w").write("\n".join([
    f"RUNTIME={cfg['Runtime']}", f"HANDLER={cfg['Handler']}", f"MEMORY={cfg['MemorySize']}",
    f"TIMEOUT={cfg['Timeout']}", f"ARCH={cfg['Architectures'][0]}", f"PROD_VERSION={cfg['Version']}",
    f"SUBNETS={','.join(vpc['SubnetIds'])}", f"SGS={','.join(vpc['SecurityGroupIds'])}",
]) + "\n")
PY
# shellcheck disable=SC1091
source "$WORK/fn.env"
rm -f "$WORK/prod-config.json"
if [ -n "${TEST_LAMBDA_SG:-}" ]; then SGS="$TEST_LAMBDA_SG"; fi
echo "ใช้โค้ดเวอร์ชัน $PROD_VERSION, $RUNTIME, ${MEMORY}MB, timeout ${TIMEOUT}s, reserved concurrency $RESERVED"
echo "security group ของ Lambda: $SGS  (RDS ทดสอบต้องเปิดพอร์ต $TEST_DB_PORT ให้ security group นี้)"

step "ดาวน์โหลดโค้ด $PROD_FN:live"
CODE_URL=$(aws lambda get-function --function-name "$PROD_FN" --qualifier live --query Code.Location --output text)
curl -fsSL "$CODE_URL" -o "$WORK/code.zip"

step "สร้าง IAM role $ROLE (อ่านได้เฉพาะ secret ทดสอบ)"
cat > "$WORK/trust.json" <<'J'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}
J
cat > "$WORK/secret-policy.json" <<J
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"secretsmanager:GetSecretValue","Resource":"$TEST_DB_SECRET_ARN"}]}
J
ROLE_ARN=$(aws iam create-role --role-name "$ROLE" --assume-role-policy-document "file://$WORK/trust.json" \
  --tags Key=purpose,Value=loadtest --query Role.Arn --output text)
echo "ROLE=$ROLE" > "$STATE"
aws iam attach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
aws iam put-role-policy --role-name "$ROLE" --policy-name read-loadtest-db-secret --policy-document "file://$WORK/secret-policy.json"
echo "รอ IAM role พร้อม 15 วินาที"; sleep 15

step "สร้าง Lambda $FN"
FN_ARN=$(aws lambda create-function --function-name "$FN" --runtime "$RUNTIME" --handler "$HANDLER" \
  --role "$ROLE_ARN" --zip-file "fileb://$WORK/code.zip" --memory-size "$MEMORY" --timeout "$TIMEOUT" \
  --architectures "$ARCH" --vpc-config "SubnetIds=$SUBNETS,SecurityGroupIds=$SGS" \
  --environment "file://$WORK/env.json" --tags purpose=loadtest --query FunctionArn --output text)
echo "FN=$FN" >> "$STATE"
rm -f "$WORK/env.json" "$WORK/code.zip"
aws lambda wait function-active-v2 --function-name "$FN"
aws lambda put-function-concurrency --function-name "$FN" --reserved-concurrent-executions "$RESERVED" >/dev/null

step "สร้าง HTTP API $API_NAME"
AUTH_JSON=$(aws apigatewayv2 get-authorizers --api-id "$PROD_API_ID" \
  --query "Items[?AuthorizerType=='JWT']|[0].JwtConfiguration" --output json)
[ "$AUTH_JSON" != "null" ] || die "หา JWT authorizer ของ API จริงไม่เจอ"
API_ID=$(aws apigatewayv2 create-api --name "$API_NAME" --protocol-type HTTP --tags purpose=loadtest --query ApiId --output text)
echo "API_ID=$API_ID" >> "$STATE"
INTEG=$(aws apigatewayv2 create-integration --api-id "$API_ID" --integration-type AWS_PROXY \
  --integration-uri "$FN_ARN" --payload-format-version 2.0 --query IntegrationId --output text)
AUTH_ID=$(aws apigatewayv2 create-authorizer --api-id "$API_ID" --name coed-loadtest-jwt --authorizer-type JWT \
  --identity-source '$request.header.Authorization' --jwt-configuration "$AUTH_JSON" --query AuthorizerId --output text)
aws apigatewayv2 create-route --api-id "$API_ID" --route-key 'GET /api/directory/companies' --target "integrations/$INTEG" >/dev/null
aws apigatewayv2 create-route --api-id "$API_ID" --route-key 'GET /api/directory/companies/{id}' --target "integrations/$INTEG" >/dev/null
aws apigatewayv2 create-route --api-id "$API_ID" --route-key 'ANY /api/v3/{proxy+}' --target "integrations/$INTEG" \
  --authorization-type JWT --authorizer-id "$AUTH_ID" --authorization-scopes coed-api/access >/dev/null
THROTTLE=$(aws apigatewayv2 get-stages --api-id "$PROD_API_ID" \
  --query "Items[?StageName=='\$default']|[0].DefaultRouteSettings.{ThrottlingBurstLimit:ThrottlingBurstLimit,ThrottlingRateLimit:ThrottlingRateLimit}" --output json)
if echo "$THROTTLE" | grep -q '[0-9]'; then
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy --default-route-settings "$THROTTLE" >/dev/null
else
  aws apigatewayv2 create-stage --api-id "$API_ID" --stage-name '$default' --auto-deploy >/dev/null
fi
aws lambda add-permission --function-name "$FN" --statement-id apigw-loadtest --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT:$API_ID/*/*" >/dev/null
API_URL="https://$API_ID.execute-api.$AWS_REGION.amazonaws.com"
echo "API_URL=$API_URL" >> "$STATE"

step "สร้าง CloudWatch dashboard $DASHBOARD"
python3 - "$WORK/dashboard.json" "$FN" "$API_ID" "$TEST_DB_ID" "$PROD_FN" "$AWS_REGION" <<'PY'
import json, sys
out, fn, api, db, prod, region = sys.argv[1:]
def w(title, metrics, x, y, stat="Sum"):
    return {"type": "metric", "x": x, "y": y, "width": 12, "height": 6, "properties": {
        "title": title, "region": region, "period": 60, "stat": stat, "view": "timeSeries", "metrics": metrics}}
widgets = [
    w("Lambda ทดสอบ: Invocations / Errors / Throttles", [
        ["AWS/Lambda", "Invocations", "FunctionName", fn], [".", "Errors", ".", "."], [".", "Throttles", ".", "."]], 0, 0),
    w("Lambda ConcurrentExecutions (ทดสอบ / ของจริง / ทั้งบัญชี)", [
        ["AWS/Lambda", "ConcurrentExecutions", "FunctionName", fn, {"label": "ทดสอบ"}],
        ["...", prod, {"label": "ของจริง"}],
        ["AWS/Lambda", "ConcurrentExecutions", {"label": "ทั้งบัญชี"}]], 12, 0, "Maximum"),
    w("Lambda ทดสอบ: Duration p95 (ms)", [["AWS/Lambda", "Duration", "FunctionName", fn]], 0, 6, "p95"),
    w("API ทดสอบ: Count / 4xx / 5xx", [
        ["AWS/ApiGateway", "Count", "ApiId", api], [".", "4xx", ".", "."], [".", "5xx", ".", "."]], 12, 6),
    w("API ทดสอบ: Latency p95 (ms)", [["AWS/ApiGateway", "Latency", "ApiId", api]], 0, 12, "p95"),
    w("RDS ทดสอบ: CPUUtilization (%)", [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", db]], 12, 12, "Maximum"),
    w("RDS ทดสอบ: DatabaseConnections", [["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", db]], 0, 18, "Maximum"),
    w("RDS ทดสอบ: FreeableMemory", [["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", db]], 12, 18, "Minimum"),
]
json.dump({"widgets": widgets}, open(out, "w"), ensure_ascii=False)
PY
aws cloudwatch put-dashboard --dashboard-name "$DASHBOARD" --dashboard-body "file://$WORK/dashboard.json" >/dev/null
echo "DASHBOARD=$DASHBOARD" >> "$STATE"

step "เสร็จแล้ว"
echo "API ทดสอบ:  $API_URL"
echo "Dashboard:  https://$AWS_REGION.console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#dashboards/dashboard/$DASHBOARD"
echo "ลองเรียก:   curl -s \"$API_URL/api/directory/companies?page=1&pageSize=5\" | head -c 300"
echo "ลบทั้งหมด:  bash scripts/loadtest/stack-down.sh"
