#!/usr/bin/env bash
# ลบทุกอย่างที่ stack-up.sh สร้าง (Lambda, HTTP API, dashboard, log group, IAM role)
# ไม่แตะ RDS ทดสอบและบัญชี Cognito ทดสอบ ซึ่งมีขั้นตอนลบของตัวเอง
set -uo pipefail
export AWS_PROFILE="${AWS_PROFILE:-coed-v4}"
export AWS_REGION=ap-southeast-2 AWS_DEFAULT_REGION=ap-southeast-2
export AWS_PAGER=""

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/tmp/loadtest/stack-state.env"
[ -f "$STATE" ] || { echo "ไม่พบ $STATE (ยังไม่ได้สร้าง หรือถูกลบไปแล้ว)"; exit 1; }
# shellcheck disable=SC1090
source "$STATE"
case "${FN:-}" in coed-api|coed-tu-auth|coed-tu-session-issuer) echo "หยุด: FN ชี้ไปฟังก์ชันจริง"; exit 1;; esac
[ "${API_ID:-}" = "yhfevhqtoa" ] && { echo "หยุด: API_ID เป็น API จริง"; exit 1; }

echo "จะลบ: dashboard=${DASHBOARD:-} api=${API_ID:-} function=${FN:-} role=${ROLE:-}"
read -r -p "พิมพ์ yes เพื่อยืนยัน: " OK
[ "$OK" = "yes" ] || { echo "ยกเลิก"; exit 1; }

ok=1
run() { if "$@" >/dev/null 2>&1; then echo "ลบแล้ว: $*"; else echo "ไม่สำเร็จ (อาจไม่มีอยู่แล้ว): $*"; ok=0; fi; }
[ -n "${DASHBOARD:-}" ] && run aws cloudwatch delete-dashboards --dashboard-names "$DASHBOARD"
[ -n "${API_ID:-}" ] && run aws apigatewayv2 delete-api --api-id "$API_ID"
if [ -n "${FN:-}" ]; then
  run aws lambda delete-function --function-name "$FN"
  run aws logs delete-log-group --log-group-name "/aws/lambda/$FN"
fi
if [ -n "${ROLE:-}" ]; then
  run aws iam delete-role-policy --role-name "$ROLE" --policy-name read-loadtest-db-secret
  run aws iam detach-role-policy --role-name "$ROLE" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
  run aws iam delete-role --role-name "$ROLE"
fi
if [ "$ok" = 1 ]; then mv "$STATE" "$STATE.deleted"; echo "เรียบร้อย"; else echo "บางอย่างลบไม่สำเร็จ ตรวจใน console แล้วรันซ้ำได้"; fi
