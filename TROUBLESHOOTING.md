# 트러블슈팅 기록

프로젝트 진행 중 발생한 이슈를 발생 시점에 기록한다. (요구사항: README/결과보고서에 최소 2건)

---

## #1. 분리 컨테이너 환경에서 "Zabbix agent is not available"

- **발생일:** 2026-06-30 (Day 1, 스택 최초 기동 직후)
- **증상:** Web UI의 Problems에 `Zabbix server / Linux: Zabbix agent is not available (for 3m)` 경고가 상시 표시됨.
- **환경:** 단일 VM Docker Compose. `zabbix-server`와 `zabbix-agent2`가 각각 별도 컨테이너.

### 원인 분석
- 기본 호스트 "Zabbix server"의 Agent 인터페이스 주소가 `127.0.0.1`로 설정되어 있었음.
- 단일 호스트에 agent가 함께 설치된 전통적 구성에서는 `127.0.0.1`이 맞지만, **컨테이너 분리 구성에서는 server 컨테이너의 `127.0.0.1`이 자기 자신**을 가리키므로 별도 컨테이너의 agent에 도달할 수 없음.
- 통신 방향을 구분해 진단:
  - **Active** (agent → `zabbix-server:10051`): 정상. agent 로그에 `active check ... is working again` 확인.
  - **Passive** (server → agent:10050, 호스트 인터페이스 주소 사용): 실패 → 가용성 경고 발생.

### 해결
- `Data collection → Hosts → "Zabbix server" → Interfaces → Agent`
  - Connect to: **DNS**
  - DNS: **`zabbix-agent2`** (Compose 서비스명 = Docker 네트워크 DNS 별칭)
  - Port: `10050`
- 1~3분(폴링 주기) 후 ZBX 가용성 아이콘 초록색 전환, 경고 RESOLVED.

### 배운 점
- 컨테이너 분리 환경에서는 호스트 인터페이스를 **고정 IP가 아니라 서비스명 DNS**로 두어야 한다(컨테이너 IP는 재시작 시 가변).
- Zabbix agent 가용성 문제는 항상 **Active/Passive 통신 방향을 먼저 구분**해 진단한다.

---

## #2. Basic Auth가 걸리지 않음 (`return`이 `auth_basic`보다 먼저 실행)

- **발생일:** 2026-07-01 (nginx `/secure` 고도화 검증 중)
- **증상:** `/secure`를 자격 없이 요청했는데 `401`이 아니라 **`200 "SECURE OK"`** 반환 → 인증이 무력화됨.
- **환경:** nginx `location = /secure` 에 `auth_basic` + `return 200 "SECURE OK";` 조합.

### 원인 분석
- nginx 요청 처리 단계 순서: **rewrite → access → content**.
- `return`(rewrite 모듈)은 **rewrite 단계에서 즉시 요청을 종료**한다.
- `auth_basic`은 **access 단계**에서 검사되는데, `return`이 그 전에 끝내버려 **auth 검사를 건너뜀**.

### 해결
- `return` 대신 **실제 파일 서빙(`alias`)** 으로 변경 → access 단계(auth) 통과 후 content 단계에서 파일 서빙.
- 보호 대상 파일(`secure.txt`)은 **webroot 밖(`/etc/nginx/auth`)** 에 두어 `/secure` 외 경로로 직접 노출되지 않게 함.

### 배운 점
- **인증이 필요한 응답에는 `return`을 쓰지 않는다** — `return`은 access phase(auth)를 건너뛴다.
- nginx는 "지시어를 쓴 순서"가 아니라 "**처리 단계(phase) 순서**"로 동작한다.
