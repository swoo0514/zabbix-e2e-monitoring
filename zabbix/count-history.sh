#!/usr/bin/env bash
# 아이템의 DB 저장 히스토리 개수 조회 — 유실 = 송신 N − 저장개수 판정용.
# 사용: ZBX_PASS='...' bash zabbix/count-history.sh <key> [최근N초]
# 주의: [최근N초]는 실행 시점 기준 슬라이딩 창 — 재조회 시 창이 밀림(고정 구간은 버킷 집계로).
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요.}"
KEY="${1:-burst.direct}"
WINDOW="${2:-}"
HTYPE="${ZBX_HISTORY:-3}"
command -v jq >/dev/null || { echo "❌ jq 필요"; exit 1; }

api() { local hdr=(-H 'Content-Type: application/json-rpc'); [ "${3:-}" ] && hdr+=(-H "Authorization: Bearer $3")
  curl -s "$ZBX_URL" "${hdr[@]}" -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",method:$m,params:$p,id:1}')"; }

TOKEN=$(api user.login "$(jq -n --arg u "$ZBX_USER" --arg p "$ZBX_PASS" '{username:$u,password:$p}')" | jq -r '.result // empty')
[ -n "$TOKEN" ] || { echo "❌ 로그인 실패"; exit 1; }
ITEMID=$(api item.get "$(jq -n --arg k "$KEY" '{output:["itemid"],filter:{key_:[$k]}}')" "$TOKEN" | jq -r '.result[0].itemid // empty')
[ -n "$ITEMID" ] || { echo "❌ 아이템($KEY) 없음"; exit 1; }

# time_from 필터(선택). Zabbix time는 epoch초.
TIMEFILT=""
[ -n "$WINDOW" ] && TIMEFILT=", time_from: $(( $(date +%s) - WINDOW ))"

RES=$(api history.get "$(jq -n --arg id "$ITEMID" --argjson h "$HTYPE" \
  "{output:\"extend\", history:\$h, itemids:[\$id], sortfield:\"clock\", sortorder:\"DESC\"${TIMEFILT}}")" "$TOKEN")

CNT=$(echo "$RES" | jq '.result | length')
MAXV=$(echo "$RES" | jq -r '[.result[].value | tonumber] | max // "n/a"')
LASTV=$(echo "$RES" | jq -r '.result[0].value // "n/a"')
echo "item=$KEY itemid=$ITEMID  저장개수=$CNT  최근값=$LASTV  최댓값(순번)=$MAXV"
api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
