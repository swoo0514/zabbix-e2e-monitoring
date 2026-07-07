#!/usr/bin/env bash
# =============================================================================
# [ACT1/2 부하실험] Availability Lab 프로비저닝 (Config-as-Code)
#   update-item-script.sh의 API 패턴(user.login → Bearer → *.create) 클론.
#   검증된 호스트와 분리된 host "burst-lab"에 trapper 아이템 2종을 멱등 생성.
#
# 사용 (VM에서):
#   ZBX_PASS='관리자비밀번호' bash zabbix/provision-burst-lab.sh          # 생성(멱등)
#   ZBX_PASS='관리자비밀번호' bash zabbix/provision-burst-lab.sh delete   # 티어다운(역순)
#
# 옵션(env): ZBX_URL(기본 http://localhost:8080/api_jsonrpc.php), ZBX_USER(기본 Admin)
#
# 만드는 것:
#   - host group: Availability Lab
#   - host: burst-lab (인터페이스 없음 — trapper는 서버가 값을 받는 방향이라 불필요)
#   - item: burst.direct  (Act1: 직접 push)   type=2(trapper) value_type=3(unsigned) history=7d trends=0
#   - item: burst.kafka   (Act2: Kafka 경유)  동일 스펙 → 사과-대-사과 비교
#   근거: trapper item  https://www.zabbix.com/documentation/7.0/en/manual/config/items/itemtypes/trapper
#         item.create   https://www.zabbix.com/documentation/7.0/en/manual/api/reference/item/create
#         (value_type: 0=float 1=char 2=log 3=unsigned 4=text / type: 2=Zabbix trapper)
# =============================================================================
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요. 예) ZBX_PASS='...' bash zabbix/provision-burst-lab.sh}"
MODE="${1:-create}"
GROUP="Availability Lab"
HOST="burst-lab"
command -v jq >/dev/null || { echo "❌ jq 필요: sudo apt install -y jq"; exit 1; }

api() { # $1=method $2=params(json)  [$3=token]
  local hdr=(-H 'Content-Type: application/json-rpc')
  [ "${3:-}" ] && hdr+=(-H "Authorization: Bearer $3")
  curl -s "$ZBX_URL" "${hdr[@]}" \
    -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",method:$m,params:$p,id:1}')"
}

TOKEN=$(api user.login "$(jq -n --arg u "$ZBX_USER" --arg p "$ZBX_PASS" '{username:$u,password:$p}')" | jq -r '.result // empty')
[ -n "$TOKEN" ] || { echo "❌ 로그인 실패 (계정/URL 확인)"; exit 1; }

hostid()  { api host.get      "$(jq -n --arg h "$HOST"  '{output:["hostid"],filter:{host:[$h]}}')"       "$TOKEN" | jq -r '.result[0].hostid // empty'; }
groupid() { api hostgroup.get "$(jq -n --arg g "$GROUP" '{output:["groupid"],filter:{name:[$g]}}')"      "$TOKEN" | jq -r '.result[0].groupid // empty'; }
itemid()  { api item.get      "$(jq -n --arg k "$1"     '{output:["itemid"],filter:{key_:[$k]}}')"       "$TOKEN" | jq -r '.result[0].itemid // empty'; }

if [ "$MODE" = "delete" ]; then
  HID=$(hostid); GID=$(groupid)
  [ -n "$HID" ] && { api host.delete      "[\"$HID\"]" "$TOKEN" >/dev/null; echo "🗑  host $HOST 삭제"; }
  [ -n "$GID" ] && { api hostgroup.delete "[\"$GID\"]" "$TOKEN" >/dev/null; echo "🗑  group $GROUP 삭제"; }
  api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
  echo "✅ 티어다운 완료"; exit 0
fi

# --- create (멱등) ---
GID=$(groupid)
[ -n "$GID" ] || GID=$(api hostgroup.create "$(jq -n --arg g "$GROUP" '{name:$g}')" "$TOKEN" | jq -r '.result.groupids[0]')
echo "→ group $GROUP: $GID"

HID=$(hostid)
[ -n "$HID" ] || HID=$(api host.create "$(jq -n --arg h "$HOST" --arg g "$GID" '{host:$h,groups:[{groupid:$g}],interfaces:[]}')" "$TOKEN" | jq -r '.result.hostids[0]')
echo "→ host $HOST: $HID"

for KEY in burst.direct burst.kafka; do
  if [ -z "$(itemid "$KEY")" ]; then
    RES=$(api item.create "$(jq -n --arg h "$HID" --arg k "$KEY" \
      '{hostid:$h,name:("Burst "+$k),key_:$k,type:2,value_type:3,history:"7d",trends:"0"}')" "$TOKEN")
    echo "$RES" | jq -e '.result.itemids' >/dev/null 2>&1 && echo "  ✅ item $KEY 생성" || { echo "  ❌ $KEY:"; echo "$RES" | jq .; }
  else
    echo "  = item $KEY 이미 있음(skip)"
  fi
done

api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
echo "✅ 프로비저닝 완료. 버스트: docker exec zbx-agent2 zabbix_sender -z zabbix-server -i <입력파일>"
