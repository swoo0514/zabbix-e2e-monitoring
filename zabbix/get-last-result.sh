#!/usr/bin/env bash
# =============================================================================
# 마스터 Browser item(browser.midibus.e2e)의 "가장 최근 반환 JSON"을 조회 (검증용)
#
# 사용 (VM에서):
#   ZBX_PASS='관리자비밀번호' bash zabbix/get-last-result.sh [steps|err|perf|raw]
#
#   steps : 스텝 성공여부 + failed_step + 스텝별 소요시간   (기본값)
#   err   : 실패 지점(err_at)·에러 분류(err_class)          (에러 경로 검증용)
#   perf  : 전체 duration + 수집된 perf 마크 목록
#   raw   : 반환 JSON 전체
#
# 옵션(환경변수): ZBX_URL(기본 http://localhost:8080/api_jsonrpc.php), ZBX_USER(기본 Admin)
# =============================================================================
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요. 예) ZBX_PASS='...' bash zabbix/get-last-result.sh steps}"
KEY="browser.midibus.e2e"
MODE="${1:-steps}"
command -v jq >/dev/null || { echo "❌ jq 필요: sudo apt install -y jq"; exit 1; }

api() { # $1=params(json) [$2=token]
  local hdr=(-H 'Content-Type: application/json-rpc')
  [ "${2:-}" ] && hdr+=(-H "Authorization: Bearer $2")
  curl -s "$ZBX_URL" "${hdr[@]}" -d "$1"
}

TOKEN=$(api "$(jq -n --arg u "$ZBX_USER" --arg p "$ZBX_PASS" '{jsonrpc:"2.0",method:"user.login",params:{username:$u,password:$p},id:1}')" | jq -r '.result // empty')
[ -n "$TOKEN" ] || { echo "❌ 로그인 실패 (계정/URL 확인)"; exit 1; }

ITEMID=$(api "$(jq -n --arg k "$KEY" '{jsonrpc:"2.0",method:"item.get",params:{output:["itemid"],search:{key_:$k}},id:1}')" "$TOKEN" | jq -r '.result[0].itemid // empty')
[ -n "$ITEMID" ] || { echo "❌ 아이템($KEY) 못 찾음"; exit 1; }

VAL=$(api "$(jq -n --arg id "$ITEMID" '{jsonrpc:"2.0",method:"history.get",params:{history:4,itemids:$id,sortfield:"clock",sortorder:"DESC",limit:1},id:1}')" "$TOKEN" | jq -r '.result[0].value // empty')
[ -n "$VAL" ] || { echo "❌ 이력 없음 (Execute now 후 재시도)"; exit 1; }

case "$MODE" in
  steps) echo "$VAL" | jq '{steps, failed_step, step_seconds}' ;;
  err)   echo "$VAL" | jq '{failed_step, err: .steps.err, err_at: .steps.err_at, err_class: .steps.err_class}' ;;
  perf)  echo "$VAL" | jq '{duration, perf_marks: [.performance_data.details[].mark]}' ;;
  raw)   echo "$VAL" | jq . ;;
  *)     echo "사용: bash zabbix/get-last-result.sh [steps|err|perf|raw]"; exit 1 ;;
esac

api "$(jq -n '{jsonrpc:"2.0",method:"user.logout",params:{},id:1}')" "$TOKEN" >/dev/null 2>&1 || true
