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

---

## #3. Browser Item 정석 API를 "없다"고 오판하고 우회를 자작

- **발생일:** 2026-07-02 (midibus Browser Item 구현 중)
- **증상:** `findElement`가 요소 등장 전에 `null`을 반환 → 직접 `for` 폴링 루프를 짜고, 네이티브 `confirm`도 우회 캡처를 자작함. 코드가 지저분하고 불안정.

### 원인 분석
- Browser Item API를 **WebFetch 요약본**으로만 확인 → `setElementWaitTimeout`(암묵적 대기)·`getAlert()`·`collectPerfEntries(mark)` 같은 정석 API가 **"없는 줄" 알았다.**
- 실제로는 전부 존재했다. 함정은 문서 위치 — 메서드 전체 목록은 예제 페이지(`.../itemtypes/browser`)가 **아니라** 전용 페이지에 있다:
  `manual/config/items/preprocessing/javascript/browser_item_javascript_objects`

### 해결
- 원문 마크다운(git.zabbix.com raw)을 직접 `grep` → 정석 API로 전면 리팩터.
  - 폴링 루프 → `browser.setElementWaitTimeout(10000)` (implicit wait).
  - confirm 우회 → 네비게이션 흐름은 `unhandledPromptBehavior="accept"`, 그 외 `getAlert().accept()`.
  - 스텝별 성능은 `collectPerfEntries("login")`처럼 라벨 마크.

### 배운 점
- **"기본 기능(대기/alert)이 없어 보이면 = 내가 레퍼런스를 놓친 신호"** 로 의심한다. 결핍을 합리화하지 말 것.
- API 존재/부재는 **요약이 아니라 원문**에서 확인한다(공식문서 우선 원칙).

---

## #4. 웹 에디터 붙여넣기가 스크립트를 손상 → API 배포(config-as-code)

- **발생일:** 2026-07-02
- **증상:** Zabbix 웹 UI의 Browser Item 스크립트 편집기에 긴 JS를 붙여넣으면 문자가 드롭/병합되어 `parse error at line N`. 메모장을 경유해도 재발.

### 원인 분석
- 웹 편집기가 대용량 붙여넣기·특정 문자에서 손상을 일으킴. (부가로, 주석의 화살표 `→` 유니코드가 Duktape 파서를 깨뜨린 사례도 있어 **주석은 ASCII로** 통일.)

### 해결
- 편집기를 거치지 않고 **Zabbix API `item.update`로 스크립트를 배포**(`zabbix/update-item-script.sh`: `jq -Rs`로 파일을 문자열화해 전송).
- 부수 효과로 **config-as-code** 달성 — 스크립트가 repo에서 버전관리되고, 배포가 재현 가능.

### 배운 점
- GUI 편집기의 붙여넣기 한계는 **API 배포로 우회**하면 재현성까지 얻는다.

---

## #5. 보안키 재생 검증 — 허용 IP는 "실행 주체(selenium)의 egress IP"여야 통과

- **발생일:** 2026-07-03 (Step 4 보안키 구현 중)
- **증상:** 보안키에 "허용 IP"를 설정하면 그 키가 붙은 재생 URL이 특정 IP에서만 재생된다. 자동화로 재생 검증 시 어떤 IP를 넣을지가 문제.

### 원인 분석
- E2E에서 재생 URL을 여는 주체는 **사람의 브라우저가 아니라 selenium 컨테이너**다. 재생 요청의 출발 IP = **VM의 공인 IP(egress)**.
- 사람이 수동 테스트할 때 보이는 IP(자기 브라우저 IP)를 그대로 넣으면 selenium egress와 달라 **재생이 차단**된다.

### 해결
- 허용 IP를 **VM 공인 IP**로 설정 → selenium egress와 일치 → 재생 상태(`.jw-state-playing`) 확인. (제한이 불필요하면 비워서 "모든 IP 허용"도 가능.)

### 배운 점
- IP 기반 접근제어를 자동화로 검증할 땐 기준을 **테스트 실행 주체의 egress IP**로 잡는다(사람이 볼 때의 IP가 아니다).
