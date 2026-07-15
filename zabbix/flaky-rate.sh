#!/usr/bin/env bash
# midibus 스텝별 성공률 집계 — 성공률 = 1/(1+0), 스킵(2)은 부분실행이라 분모 제외.
# login은 항상 실행되므로 login 행이 E2E 전체 성공률의 대표값.
# 사용: ZBX_PASS='...' bash zabbix/flaky-rate.sh [일수=7]
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요. 예) ZBX_PASS='...' bash zabbix/flaky-rate.sh}"
DAYS="${1:-7}"
command -v jq >/dev/null || { echo "❌ jq 필요: sudo apt install -y jq"; exit 1; }

api() { # $1=method $2=params(json) [$3=token]
  local hdr=(-H 'Content-Type: application/json-rpc')
  [ "${3:-}" ] && hdr+=(-H "Authorization: Bearer $3")
  curl -s "$ZBX_URL" "${hdr[@]}" \
    -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",method:$m,params:$p,id:1}')"
}

TOKEN=$(api user.login "$(jq -n --arg u "$ZBX_USER" --arg p "$ZBX_PASS" '{username:$u,password:$p}')" | jq -r '.result // empty')
[ -n "$TOKEN" ] || { echo "❌ 로그인 실패 (계정/URL 확인)"; exit 1; }

FROM=$(date -d "-${DAYS} days" +%s)
echo "=== 최근 ${DAYS}일 midibus 스텝 성공률 ($(date -d "@$FROM" '+%Y-%m-%d %H:%M') ~ now) ==="
printf "%-26s %6s %6s %6s %6s %8s\n" "스텝" "총" "성공" "실패" "스킵" "성공률"

for KEY in midibus.step.login midibus.step.category midibus.step.deploy \
           midibus.step.media midibus.step.securitykey midibus.step.subuser; do
  IID=$(api item.get "$(jq -n --arg k "$KEY" '{output:["itemid"],filter:{key_:[$k]}}')" "$TOKEN" | jq -r '.result[0].itemid // empty')
  if [ -z "$IID" ]; then printf "%-26s %6s\n" "$KEY" "(item 없음)"; continue; fi
  RES=$(api history.get "$(jq -n --arg id "$IID" --argjson f "$FROM" \
        '{output:"extend",history:3,itemids:[$id],time_from:$f,limit:200000}')" "$TOKEN")
  read -r TOT S F SK < <(echo "$RES" | jq -r '
    [.result[].value|tonumber] as $v
    | "\($v|length) \([$v[]|select(.==1)]|length) \([$v[]|select(.==0)]|length) \([$v[]|select(.==2)]|length)"')
  BASE=$(( S + F ))
  if [ "$BASE" -gt 0 ]; then RATE=$(awk "BEGIN{printf \"%.1f\", $S*100/$BASE}"); else RATE="n/a"; fi
  printf "%-26s %6d %6d %6d %6d %7s%%\n" "$KEY" "$TOT" "$S" "$F" "$SK" "$RATE"
done

api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
echo "※ 성공률 = 성공(1) / (성공+실패). login 행이 E2E 전체 성공률의 대표값."
