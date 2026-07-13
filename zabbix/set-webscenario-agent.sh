#!/usr/bin/env bash
# =============================================================================
# Web Scenario의 User-agent(Agent 필드)를 API로 설정 — 요구사항 4.1 정합
#
# 배경: Agent 필드를 비워두면 Zabbix 기본 UA로 요청된다. 요구사항서 4.1은
#       커스텀 UA(예: Zabbix-Monitor/1.0) 명시를 요구 → httptest.update로 주입.
#       https://www.zabbix.com/documentation/7.0/en/manual/api/reference/httptest/update
#
# 사용 (VM에서):
#   ZBX_PASS='관리자비밀번호' bash zabbix/set-webscenario-agent.sh
#
# 옵션(환경변수): ZBX_URL(기본 http://localhost:8080/api_jsonrpc.php), ZBX_USER(기본 Admin)
#                ZBX_HTTPTEST(기본 nginx-availability), ZBX_AGENT(기본 Zabbix-Monitor/1.0)
#
# 검증: 실행 후 nginx 접근 로그에서 UA 확인 —
#   docker compose logs --tail 20 nginx | grep 'Zabbix-Monitor'
# =============================================================================
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요. 예) ZBX_PASS='...' bash zabbix/set-webscenario-agent.sh}"
HTTPTEST="${ZBX_HTTPTEST:-nginx-availability}"
AGENT="${ZBX_AGENT:-Zabbix-Monitor/1.0}"

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

echo "→ Web Scenario 조회: $HTTPTEST"
ID=$(api httptest.get "$(jq -n --arg n "$HTTPTEST" '{filter:{name:$n},output:["httptestid","name","agent"]}')" "$TOKEN" | jq -r '.result[0].httptestid // empty')
[ -n "$ID" ] || { echo "❌ Web Scenario 못 찾음: $HTTPTEST"; exit 1; }

echo "→ agent 설정: '$AGENT' (httptestid=$ID)"
RES=$(api httptest.update "$(jq -n --arg id "$ID" --arg a "$AGENT" '{httptestid:$id,agent:$a}')" "$TOKEN")
echo "$RES" | jq -e '.result.httptestids' >/dev/null || { echo "❌ 갱신 실패: $RES"; exit 1; }

# 서버에 실제 반영됐는지 재조회로 확인
AFTER=$(api httptest.get "$(jq -n --arg id "$ID" '{httptestids:[$id],output:["agent"]}')" "$TOKEN" | jq -r '.result[0].agent')
echo "✅ 완료 — 서버의 agent 값: '$AFTER'"
echo "   다음 수집 주기 후 UA 확인: docker compose logs --tail 20 nginx | grep -F '$AGENT'"
