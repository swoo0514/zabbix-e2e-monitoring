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

# midibus Browser Item — E2E 자동화 트러블슈팅 (Day 3~4)

> midibus(외부 SaaS) 대상 실브라우저 5-Step 시나리오를 Zabbix Browser Item으로 구현하며 부딪힌 사례들. 대부분 "실브라우저 자동화 + Zabbix Duktape 엔진의 제약"에서 나온다.

## #3. 대기·Alert API가 "없다"고 오판하고 폴링 루프를 손으로 재발명

- **발생일:** 2026-07-02
- **증상:** `findElement`가 요소 등장 전에 `null`을 반환 → 직접 `for` 폴링 루프를 짜고, 네이티브 `confirm`도 우회 캡처를 자작함. 코드가 지저분하고 불안정.

### 원인 분석
- Browser Item API 문서를 **WebFetch 요약본**으로만 확인 → `setElementWaitTimeout`(암묵적 대기)·`getAlert()`·`collectPerfEntries(mark)` 같은 정석 API가 **"없는 줄" 알았다.**
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

## #4. 웹 에디터에 스크립트를 붙여넣으면 `parse error` (문자 누락·병합)

- **발생일:** 2026-07-02
- **증상:** Zabbix 웹 UI의 Browser Item 스크립트 편집기에 긴 JS를 붙여넣으면 문자가 드롭/병합되어 `parse error at line N`. 메모장을 경유해도 재발.

### 원인 분석
- 웹 편집기가 대용량 붙여넣기·특정 문자에서 손상을 일으킴. (부가로, 주석의 화살표 `→` 유니코드가 Duktape 파서를 깨뜨린 사례도 있어 **주석은 ASCII로** 통일.)

### 해결
- 편집기를 거치지 않고 **Zabbix API `item.update`로 스크립트를 배포**(`zabbix/update-item-script.sh`: `jq -Rs`로 파일을 문자열화해 전송).
- 부수 효과로 **config-as-code** 달성 — 스크립트가 repo에서 버전관리되고, 배포가 재현 가능.

### 배운 점
- GUI 편집기의 붙여넣기 한계는 **API 배포로 우회**하면 재현성까지 얻는다.

## #5. 대시보드 팝업·네이티브 confirm이 클릭을 가로챔

- **발생일:** 2026-07-02
- **증상:** 로그인 직후 대시보드 팝업/공지가 떠서 다음 스텝의 클릭을 막음. 삭제 시 뜨는 `confirm()` 창에서 자동화가 멈춤.

### 원인 분석
- SPA 팝업은 특정 URL 진입 시에만 뜸. 네이티브 `confirm`은 DOM이 아니라 브라우저 레벨이라 일반 클릭으로 못 없앤다.

### 해결
- 팝업 우회: 대시보드 대신 **목표 페이지로 직접 `navigate`**(`/config` 등) → 팝업 컨텍스트를 건너뜀.
- confirm: WebDriver capability `unhandledPromptBehavior="accept"`를 `opts.capabilities.alwaysMatch`에 설정(위치가 핵심 — `opts` 루트에 넣으면 안 먹음).

### 배운 점
- SPA는 **어느 경로로 진입하느냐**가 팝업 유무를 가른다. 네이티브 프롬프트는 **capability 레벨**에서 다룬다.

## #6. 버튼이 "click intercepted" — 고정 푸터/모달 푸터에 가림

- **발생일:** 2026-07-02 ~ 07-03
- **증상:** 저장/생성 버튼 클릭이 `element click intercepted: Other element would receive the click`로 실패. 범인은 화면 하단 **고정 푸터**(`#midibusFooter`)와 **모달 푸터**.

### 원인 분석
- 암묵적 대기는 요소의 **존재**만 보장하지 **가려짐/애니메이션**은 모른다. 버튼이 뷰포트 하단에서 푸터에 겹침.

### 해결
- 뷰포트 세로를 키움(`setScreenSize(1920, 1600)`)으로 겹침 완화.
- 클릭 헬퍼가 **가림/미준비 시 재시도**하도록: `intercepted` + `not interactable` 둘 다 잡아 300ms 간격으로 요소를 다시 찾아 재클릭.

### 배운 점
- implicit wait는 **존재 ≠ 상호작용 가능**. intercept/interactable은 **재시도 + 요소 리페치**로 흡수한다.

## #7. `<select>`가 `sendKeys`를 거부 (드롭다운 선택)

- **발생일:** 2026-07-03
- **증상:** 보조사용자 "등급" `<select>`에 `sendKeys("사용자")` → `element not interactable`.

### 원인 분석
- 네이티브 `<select>`는 텍스트 입력 대상이 아니다(옵션은 클릭 선택).

### 해결
- select를 **클릭해 열고**, 원하는 `option[value="USER"]`를 **클릭**해 선택.

### 배운 점
- 드롭다운은 타이핑이 아니라 **클릭 선택**. (옵션 클릭이 간헐 `not interactable`이면 #6의 재시도로 흡수.)

## #8. 모달 저장 버튼이 계속 `disabled` — 폼 검증 타이밍

- **발생일:** 2026-07-03
- **증상:** 보조사용자 추가 모달에서 모든 필드를 채웠는데 `저장` 버튼 class에 `disabled`가 남아 클릭 실패.

### 원인 분석
- 폼 검증(`checkAllInputDataForSub`)이 **텍스트 필드의 `keyup`에서만** 재실행됨. 라디오(권한)를 **마지막 텍스트 입력 뒤에** 클릭해서, 검증이 라디오 반영 전 상태로 끝나 있었다.

### 해결
- 입력 순서를 재배치: **라디오·연락처를 먼저** 세팅하고 **이름을 맨 마지막**에 입력 → 그 `keyup`이 전체를 재검증하며 버튼 활성화.

### 배운 점
- 클라이언트 폼은 **"어떤 이벤트가 검증을 트리거하는가"** 를 봐야 한다. 마지막 트리거 필드가 최종 상태를 보게 순서를 짠다.

## #9. 보안키 "재생 키 생성" 버튼이 `disabled` — 필수 "시간" 미설정

- **발생일:** 2026-07-03
- **증상:** 보안키 생성 모달에서 `#createKeyBtn`이 `disabled` + intercept로 클릭 실패.

### 원인 분석
- 모달 HTML/스크립트 확인 결과, **"시간(유효시간)"이 필수(`*`)** 이고 미입력이면 내부 플래그(`youCanCreateSecureKey.time=0`)로 버튼이 잠긴다. 자동화가 시간을 안 넣었다.

### 해결
- 퀵버튼 `#quickBtn_1day`(=86400초) 클릭으로 유효시간 설정 → 버튼 활성화 → 키 생성.

### 배운 점
- 버튼 `disabled`는 대개 **필수값/검증 상태**의 결과다. **모달의 검증 로직을 먼저 읽고** 무엇이 활성 조건인지 확인한다. (에러 메시지에 실패 요소 이름을 심어두니 어느 버튼인지 즉시 특정됨 → 디버깅 가속.)

## #10. 보안키로 재생 검증 — 허용 IP는 selenium egress(VM) IP여야 통과

- **발생일:** 2026-07-03
- **증상:** 보안키에 "허용 IP"를 걸면, 그 키가 붙은 재생 URL이 특정 IP에서만 재생된다.

### 원인 분석
- E2E에서 재생 URL을 여는 주체는 **selenium 컨테이너**다. 재생 요청의 출발 IP = **VM의 공인 IP(egress)**. 허용 IP가 이와 다르면 재생 차단.

### 해결
- 허용 IP를 **VM 공인 IP**로 설정 → selenium egress와 일치 → 재생 상태(`.jw-state-playing`) 확인. (제한이 불필요하면 비워서 "모든 IP 허용"도 가능.)

### 배운 점
- IP 기반 접근제어를 자동화로 검증할 땐 **테스트 실행 주체의 egress IP**를 기준으로 잡는다(사람이 수동으로 볼 때의 IP가 아니다).

## #11. 생성/삭제가 목록에 즉시 반영되지 않음

- **발생일:** 2026-07-03
- **증상:** 미디어·보조사용자를 만들거나 지운 직후 목록을 조회하면 반영이 안 보여 검증/삭제 대상 탐색이 실패.

### 원인 분석
- 목록이 액션 후 자동 리프레시되지 않는 화면이 있음(클라이언트 캐시/지연 렌더).

### 해결
- 액션 후 **해당 목록 URL로 다시 `navigate`**(강제 새로고침)한 뒤 행을 조회.

### 배운 점
- SPA에서 "액션 → 목록 검증"은 **명시적 새로고침**을 넣어 상태를 확정한 뒤 확인한다.
