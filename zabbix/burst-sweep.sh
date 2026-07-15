#!/usr/bin/env bash
# 레이트 스윕 부하 발생기 — R msg/s × DUR초를 직접(server)/프록시(proxy) 경로로 송신.
# 사용: bash zabbix/burst-sweep.sh <server|proxy> <rate> [dur=60]
# 값 규칙: rate*100000+순번 → 레이트별 대역 분리로 뒤섞여도 식별 가능.
# 실효 레이트는 명목보다 약간 낮음(전송시간+1s) — 판정은 "송신 총수 vs 저장 총수"라 영향 없음.
set -euo pipefail

PATHSEL="${1:?사용법: burst-sweep.sh <server|proxy> <rate> [dur=60]}"
RATE="${2:?rate(msg/s) 필요}"
DUR="${3:-60}"

case "$PATHSEL" in
  server) TARGET=zabbix-server; HOST=burst-lab;       KEY=burst.direct ;;
  proxy)  TARGET=zbx-proxy;     HOST=burst-lab-proxy; KEY=burst.proxy ;;
  *) echo "❌ 첫 인자는 server 또는 proxy"; exit 1 ;;
esac

echo "→ 스윕 시작: path=$PATHSEL target=$TARGET rate=${RATE}/s dur=${DUR}s (총 $((RATE*DUR))건)"
docker exec zbx-agent2 sh -c '
  R='"$RATE"'; D='"$DUR"'; T='"$TARGET"'; H='"$HOST"'; K='"$KEY"'
  t=1; fails=0
  while [ $t -le $D ]; do
    i=1; : > /tmp/sweep.txt
    while [ $i -le $R ]; do
      echo "$H $K $(( R*100000 + (t-1)*R + i ))" >> /tmp/sweep.txt
      i=$((i+1))
    done
    f=$(zabbix_sender -z "$T" -i /tmp/sweep.txt 2>/dev/null \
        | grep -o "failed: [0-9]*" | awk "{s+=\$2} END{print s+0}")
    fails=$((fails + f))
    t=$((t+1)); sleep 1
  done
  echo "완료: 송신 $((R*D))건, sender-failed 합=$fails"'
echo "→ 저장 확인:  ZBX_PASS='...' bash zabbix/count-history.sh $KEY $((DUR+60))"
echo "→ pused 피크: Latest data → Zabbix server → cache 그래프 max 기록"
