#!/usr/bin/env bash
# =============================================================================
# [고도화 PROXY] 프록시 등록 + 호스트 전환 프로비저닝 (Config-as-Code)
#   provision-burst-lab.sh의 API 패턴(user.login → Bearer → *.create) 클론.
#
# 하는 일 (create, 멱등):
#   1. proxy.create  — proxy-01, operating_mode=0(Active)     ※ 7.0에서 proxy 객체 개편(name/operating_mode)
#   2. host.update   — nginx-sample을 monitored_by=1(Proxy)로 전환 (proxyid 필수)
#   3. host.create   — burst-lab-proxy (그룹 Availability Lab 재사용, 프록시 감시)
#   4. item.create   — burst.proxy (trapper, burst.direct와 동일 스펙 → 사과-대-사과 비교)
#
# delete 모드 (역순 원상복구):
#   nginx-sample monitored_by=0(Server) 복귀 → burst-lab-proxy 삭제 → proxy-01 삭제
#   (그룹 Availability Lab은 burst-lab과 공유라 남긴다)
#
# 사용 (VM에서):
#   ZBX_PASS='관리자비밀번호' bash zabbix/provision-proxy-lab.sh          # 생성(멱등)
#   ZBX_PASS='관리자비밀번호' bash zabbix/provision-proxy-lab.sh delete   # 티어다운
#
# 근거(7.0 고정):
#   proxy.create  https://www.zabbix.com/documentation/7.0/en/manual/api/reference/proxy/create
#   host object(monitored_by: 0=server 1=proxy / proxyid: monitored_by=1일 때 필수)
#                 https://www.zabbix.com/documentation/7.0/en/manual/api/reference/host/object
#   trapper item  https://www.zabbix.com/documentation/7.0/en/manual/config/items/itemtypes/trapper
# =============================================================================
set -euo pipefail

ZBX_URL="${ZBX_URL:-http://localhost:8080/api_jsonrpc.php}"
ZBX_USER="${ZBX_USER:-Admin}"
: "${ZBX_PASS:?ZBX_PASS 환경변수를 설정하세요. 예) ZBX_PASS='...' bash zabbix/provision-proxy-lab.sh}"
MODE="${1:-create}"
PROXY="proxy-01"          # ★ compose의 ZBX_HOSTNAME과 정확히 일치해야 함
TARGET_HOST="nginx-sample" # 프록시 감시로 전환할 기존 호스트
LAB_HOST="burst-lab-proxy" # 부하테스트용 신규 lab 호스트
GROUP="Availability Lab"   # burst-lab과 공유(있으면 재사용)
command -v jq >/dev/null || { echo "❌ jq 필요: sudo apt install -y jq"; exit 1; }

api() { # $1=method $2=params(json)  [$3=token]
  local hdr=(-H 'Content-Type: application/json-rpc')
  [ "${3:-}" ] && hdr+=(-H "Authorization: Bearer $3")
  curl -s "$ZBX_URL" "${hdr[@]}" \
    -d "$(jq -n --arg m "$1" --argjson p "$2" '{jsonrpc:"2.0",method:$m,params:$p,id:1}')"
}

TOKEN=$(api user.login "$(jq -n --arg u "$ZBX_USER" --arg p "$ZBX_PASS" '{username:$u,password:$p}')" | jq -r '.result // empty')
[ -n "$TOKEN" ] || { echo "❌ 로그인 실패 (계정/URL 확인)"; exit 1; }

proxyid() { api proxy.get     "$(jq -n --arg n "$PROXY" '{output:["proxyid"],filter:{name:[$n]}}')"  "$TOKEN" | jq -r '.result[0].proxyid // empty'; }
hostid()  { api host.get      "$(jq -n --arg h "$1"     '{output:["hostid"],filter:{host:[$h]}}')"   "$TOKEN" | jq -r '.result[0].hostid // empty'; }
groupid() { api hostgroup.get "$(jq -n --arg g "$GROUP" '{output:["groupid"],filter:{name:[$g]}}')"  "$TOKEN" | jq -r '.result[0].groupid // empty'; }
itemid()  { api item.get      "$(jq -n --arg k "$1"     '{output:["itemid"],filter:{key_:[$k]}}')"   "$TOKEN" | jq -r '.result[0].itemid // empty'; }

if [ "$MODE" = "delete" ]; then
  # 1) nginx-sample → 서버 직접 감시 복귀 (proxyid는 monitored_by=1일 때만 필수라 0으로 되돌림)
  THID=$(hostid "$TARGET_HOST")
  [ -n "$THID" ] && { api host.update "$(jq -n --arg h "$THID" '{hostid:$h,monitored_by:0,proxyid:"0"}')" "$TOKEN" >/dev/null; echo "↩  $TARGET_HOST → Monitored by Server 복귀"; }
  # 2) lab 호스트 삭제
  LHID=$(hostid "$LAB_HOST")
  [ -n "$LHID" ] && { api host.delete "[\"$LHID\"]" "$TOKEN" >/dev/null; echo "🗑  host $LAB_HOST 삭제"; }
  # 3) 프록시 삭제
  PID=$(proxyid)
  [ -n "$PID" ] && { api proxy.delete "[\"$PID\"]" "$TOKEN" >/dev/null; echo "🗑  proxy $PROXY 삭제"; }
  api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
  echo "✅ 티어다운 완료 (그룹 $GROUP 은 burst-lab과 공유라 유지)"; exit 0
fi

# --- create (멱등) ---
# 1) 프록시 등록 — Active(0): 프록시가 서버로 접속하는 방향이라 서버 쪽 주소 설정 불필요
PID=$(proxyid)
[ -n "$PID" ] || PID=$(api proxy.create "$(jq -n --arg n "$PROXY" '{name:$n,operating_mode:"0"}')" "$TOKEN" | jq -r '.result.proxyids[0]')
echo "→ proxy $PROXY: $PID"

# 2) nginx-sample 전환 — monitored_by=1(Proxy) + proxyid
THID=$(hostid "$TARGET_HOST")
[ -n "$THID" ] || { echo "❌ 호스트($TARGET_HOST) 없음"; exit 1; }
api host.update "$(jq -n --arg h "$THID" --arg p "$PID" '{hostid:$h,monitored_by:1,proxyid:$p}')" "$TOKEN" | jq -e '.result.hostids' >/dev/null \
  && echo "→ $TARGET_HOST → Monitored by proxy($PROXY) 전환" || { echo "❌ $TARGET_HOST 전환 실패"; exit 1; }

# 3) lab 호스트 (프록시 감시, trapper라 인터페이스 불필요)
GID=$(groupid)
[ -n "$GID" ] || GID=$(api hostgroup.create "$(jq -n --arg g "$GROUP" '{name:$g}')" "$TOKEN" | jq -r '.result.groupids[0]')
LHID=$(hostid "$LAB_HOST")
[ -n "$LHID" ] || LHID=$(api host.create "$(jq -n --arg h "$LAB_HOST" --arg g "$GID" --arg p "$PID" \
  '{host:$h,groups:[{groupid:$g}],interfaces:[],monitored_by:1,proxyid:$p}')" "$TOKEN" | jq -r '.result.hostids[0]')
echo "→ host $LAB_HOST: $LHID"

# 4) trapper 아이템 — burst.direct와 동일 스펙(type=2 trapper, value_type=3 unsigned, 7d, trends 0)
if [ -z "$(itemid burst.proxy)" ]; then
  RES=$(api item.create "$(jq -n --arg h "$LHID" \
    '{hostid:$h,name:"Burst burst.proxy",key_:"burst.proxy",type:2,value_type:3,history:"7d",trends:"0"}')" "$TOKEN")
  echo "$RES" | jq -e '.result.itemids' >/dev/null 2>&1 && echo "  ✅ item burst.proxy 생성" || { echo "  ❌ burst.proxy:"; echo "$RES" | jq .; }
else
  echo "  = item burst.proxy 이미 있음(skip)"
fi

api user.logout '{}' "$TOKEN" >/dev/null 2>&1 || true
echo "✅ 프로비저닝 완료."
echo "   프록시 경유 버스트: docker exec zbx-agent2 zabbix_sender -z zbx-proxy -s $LAB_HOST -k burst.proxy -o 1"
echo "   게이트: UI Data collection → Proxies에서 $PROXY 의 Last seen 갱신 확인"
