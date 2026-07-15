#!/usr/bin/env bash
# Web Scenario의 User-agent를 API(httptest.update)로 주입 — 요구사항 4.1 정합.
# 사용: ZBX_PASS='...' bash zabbix/set-webscenario-agent.sh
# 검증: docker compose logs --tail 20 nginx | grep 'Zabbix-Monitor'
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
