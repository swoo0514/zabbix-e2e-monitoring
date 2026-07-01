#!/usr/bin/env bash
# nginx /secure 용 Basic Auth 자격 파일(.htpasswd) 생성기.
# 비밀은 .env 에만 두고(gitignore), 파생 파일 .htpasswd 는 커밋하지 않는다.
#
# 사용: (리포 루트에서) ./scripts/gen-htpasswd.sh
#   - .env 의 NGINX_SECURE_USER / NGINX_SECURE_PASS 를 읽어 해시 생성
#   - docker compose up 전에 실행해야 /secure 가 정상 동작
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "[!] .env 없음 — 'cp .env.example .env' 후 값을 채우세요." >&2; exit 1; }

# .env 전체를 source 하지 않는다(값에 공백이 있으면 bash가 깨짐).
# 필요한 두 키만 안전하게 추출(양끝 따옴표 제거).
get() { grep -E "^$1=" .env | head -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'; }
NGINX_SECURE_USER="$(get NGINX_SECURE_USER)"
NGINX_SECURE_PASS="$(get NGINX_SECURE_PASS)"

[ -n "$NGINX_SECURE_USER" ] || { echo "[!] NGINX_SECURE_USER 미설정(.env 확인)" >&2; exit 1; }
[ -n "$NGINX_SECURE_PASS" ] || { echo "[!] NGINX_SECURE_PASS 미설정(.env 확인)" >&2; exit 1; }

mkdir -p nginx/auth
# openssl passwd -apr1: 매 실행 랜덤 salt. (더 강하게는 apache htpasswd -B 로 bcrypt 권장)
printf '%s:%s\n' "$NGINX_SECURE_USER" "$(openssl passwd -apr1 "$NGINX_SECURE_PASS")" > nginx/auth/.htpasswd

echo "[+] 생성 완료: nginx/auth/.htpasswd (user=$NGINX_SECURE_USER)"
