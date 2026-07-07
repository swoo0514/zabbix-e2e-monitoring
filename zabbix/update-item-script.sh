#!/usr/bin/env bash
# =============================================================================
# Zabbix Browser item 스크립트를 API로 직접 갱신 (웹 에디터 붙여넣기 우회)
#
# 사용 (VM에서):
#   sudo apt install -y jq          # jq 없으면
#   ZBX_PASS='관리자비밀번호' bash zabbix/update-item-script.sh
#
# 옵션(환경변수): ZBX_URL(기본 http://localhost:8080/api_jsonrpc.php), ZBX_USER(기본 Admin)
#                ZBX_KEYS(기본 browser.midibus.e2e — 공백 구분 복수 키 가능)
#   예) 온디맨드 아이템만:  ZBX_KEYS="browser.midibus.ondemand" ZBX_PASS='...' bash zabbix/update-item-script.sh
#       둘 다:              ZBX_KEYS="browser.midibus.e2e browser.midibus.ondemand" ZBX_PASS='...' bash ...
# =============================================================================
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요. 예) ZBX_PASS='...' bash zabbix/update-item-script.sh}"
KEYS="${ZBX_KEYS:-browser.midibus.e2e}"
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_FILE="${ZBX_SCRIPT:-$DIR/midibus-browser-item.js}"   # ZBX_SCRIPT로 임시본(fault injection) 배포 가능

[ -f "$SCRIPT_FILE" ] || { echo "❌ 스크립트 파일 없음: $SCRIPT_FILE"; exit 1; }
command -v jq >/dev/null || { echo "❌ jq 필요: sudo apt install -y jq"; exit 1; }

api() { # $1=method $2=params(json)  [$3=token]
  local hdr=(-H 'Content-Type: application/json-rpc')
  [ "${3:-}" ] && hdr+=(-H "Authorization: Bearer $3")
  curl -s "$ZBX_URL" "${hdr[@]}" \
    -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",method:$m,params:$p,id:1}')"
}

echo "→ 로그인: $ZBX_USER @ $ZBX_URL"
TOKEN=$(api user.login "$(jq -n --arg u "$ZBX_USER" --arg p "$ZBX_PASS" '{username:$u,password:$p}')" | jq -r '.result // empty')
[ -n "$TOKEN" ] || { echo "❌ 로그인 실패 (계정/URL 확인)"; exit 1; }

SCRIPT_JSON=$(jq -Rs . < "$SCRIPT_FILE")   # 파일을 안전한 JSON 문자열로(이스케이프 자동)

for KEY in $KEYS; do
  echo "→ 아이템 조회: key=$KEY"
  ITEMID=$(api item.get "$(jq -n --arg k "$KEY" '{output:["itemid","name"],filter:{key_:$k}}')" "$TOKEN" | jq -r '.result[0].itemid // empty')
  [ -n "$ITEMID" ] || { echo "❌ 아이템($KEY) 못 찾음"; exit 1; }

  echo "→ 스크립트 push: itemid=$ITEMID  <= $SCRIPT_FILE"
  RES=$(api item.update "$(jq -n --arg id "$ITEMID" --argjson s "$SCRIPT_JSON" '{itemid:$id,params:$s}')" "$TOKEN")

  if echo "$RES" | jq -e '.result.itemids' >/dev/null 2>&1; then
    echo "✅ 갱신 완료 (key=$KEY, itemid=$ITEMID)."
  else
    echo "❌ 업데이트 실패 (key=$KEY):"; echo "$RES" | jq .
    exit 1
  fi
done
echo "→ 전체 완료. Zabbix에서 Execute now."

api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
