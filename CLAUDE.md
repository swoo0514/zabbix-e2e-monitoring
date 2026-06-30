# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 프로젝트

**Zabbix E2E 시나리오 테스트 기반 웹서비스 가용성 모니터링 구축** (KINX 인턴십 과제, 단독 수행).

- **목표:** Zabbix 7.x LTS의 Web Scenario + Browser Item으로 웹서비스 E2E 가용성을 모니터링하고, 장애 발생 시 자동 알림(PROBLEM → RESOLVED) 체계를 완성한다.
- **배포:** Cloud VM(IXcloud, Ubuntu 24.04) 위 Docker Compose 단일 스택.
- **모니터링 대상:** ① nginx 샘플 앱(Web Scenario) ② midibus 웹서비스(Browser Item).
- **발표일: 2026-07-13.** 이것이 유일한 하드 데드라인. (Notion 일정은 06-30 ~ 07-09, 07-10~12는 버퍼)
- 상세 요구사항·개념 정리는 `private/` 폴더의 요구사항서(v1.1) docx, 개념정리 PDF 참조. (`private/`는 git 미추적)

---

## 함께 일하는 사람 — 먼저 읽을 것

- **Zabbix를 처음 사용한다.** 모든 Zabbix 개념·설정은 초보 기준으로 설명이 필요하다.
- **인턴이며 학습이 주 목적.** 단, 이 E2E 시스템은 현재 실무에서도 쓰이고 있는 것으로 보임 → 학습용 장난감이 아니라 **실무 기준**으로 다뤄야 한다.
- 기대치: "동작하는 결과물"보다 **"왜 이렇게 했는지 이해하는 것"** 이 우선이다.

---

## 프로젝트 철학 — 요구사항은 바닥이지 천장이 아니다

- 요구사항서는 **최소 기준(baseline)**일 뿐 절대 기준이 아니다. **평가의 숨은 가치 = 스펙을 넘어 "자신만의 색깔로 어떻게 고도화·차별화했고, 거기서 어떤 인사이트를 뽑아냈는가"** 와 그 고민 과정이다.
- 따라서 매 단계에서 "요구는 충족하되, 여기서 한 걸음 더 나갈 방법은?"을 **능동적으로 먼저 제안**한다. 고도화 아이디어·트레이드오프·인사이트를 기다리지 말고 던진다.
- **MySQL→PostgreSQL 데이터 마이그레이션은 사용자의 실제 팀이 준비 중인 실무 과제**다. 단순 학습용이 아니라 Browser Item과 **동급의 최우선 고도화 트랙**으로 다룬다(설정뿐 아니라 **이력 데이터 보존 + 무결성 검증** 포함; pgloader/병렬운영 등 현업 기법). 코어는 PostgreSQL-only로 구축하되, 이 마이그레이션은 핵심 고도화로 별도 추진.

---

## 작업 원칙 (타협 불가 — 매 작업 적용)

### 1. 공식 문서 우선 (Official-docs-first)
- 모든 설정값·명령·아키텍처 결정은 **공식 문서/공식 레퍼런스를 근거로** 제시한다. 기억이나 추측으로 답하지 말 것.
- 링크를 제시할 때는 **버전을 명시**하고, 사용자가 실제 배포한 Zabbix 버전과 URL의 버전이 일치하는지 확인하도록 상기시킨다. (아래 "주요 공식 레퍼런스" 참고)
- 공식 문서에 없는, 커뮤니티/블로그 기반 정보는 "공식 아님"이라고 명확히 구분해서 말한다.

### 2. 모든 설정에 판단 근거 (Rationale for every config)
YAML/conf/env 등 **설정 파일의 키 하나하나를 건드릴 때마다** 아래를 함께 제시한다. 사용자가 명시적으로 생략을 요청하기 전까지 항상.

> - **무엇을:** 어떤 파일의 어떤 키를 어떤 값으로
> - **공식 근거:** 공식 문서 권고인가? (링크) 권고 기본값인가, 우리가 바꾼 값인가
> - **판단 근거:** 왜 이 값인가
> - **고려한 대안:** 다른 선택지는 무엇이었나
> - **왜 채택/기각:** 그 대안을 왜 안 썼나

### 3. 현업자 시선 (Practitioner lens)
매 단계에서 현업 엔지니어가 던질 법한 질문을 같이 던지고 답한다:
- "왜 이렇게 설정했지? 운영 환경에서도 이게 맞나?"
- "이건 고려해봤나? 저건 왜 안 했지?"
- "이 기본값은 실무에서 흔히 바꾸나? 보안/성능/유지보수 관점에서 함정은?"

### 4. 놓친 것·새 사실을 먼저 알린다 (Surface gaps proactively)
- 사용자가 놓치고 있는 부분, 요구사항/공식 문서와 어긋나는 부분, 새로 알아야 할 사실을 **중간중간 먼저** 짚어준다. 질문을 기다리지 말 것.

### 5. 가르치면서 한다 (Teach, don't just do)
- 그냥 코드를 뱉지 말고, 초보가 따라올 수 있게 개념 → 근거 → 실행 순으로 설명한다.
- **설정 파일은 "한 줄/한 키 단위" 설명**을 기본으로 한다: 각 키의 역할 + 공식 문서 링크 + 봐야 할 개념 + "지금 무슨 작업을 한 것인지/현재 위치".

### 6. 작업 단위가 끝나면 Notion에 문서화 (Document each unit to Notion)
- **한 단위의 작업(예: docker-compose.yml 작성, nginx 앱 구성, Trigger 설정)이 끝나면**, 해당 작업의 Notion 페이지("Zabbix 작업 (Day별)" DB의 해당 행 페이지) 안에 **Notion 마크다운으로 문서를 추가**한다.
- 이건 훅으로 자동화 불가(작업 완료 판단은 의미적 추론이고, 훅은 Notion MCP를 호출 못 함) → **Claude가 판단해서 Notion MCP로 직접 작성**한다.
- 문서 표준 구성: ① 작업 단위·상태·날짜(callout) ② 무슨 작업을 했나 ③ 블록별 한 줄 설명 + **클릭 가능한 공식 링크** ④ 봐야 할 개념 체크리스트 ⑤ 주의/함정 ⑥ 다음 단계.
- 채팅 설명과 동일 내용을 Notion에도 남겨, 사용자가 Notion에서 링크 접속·복습할 수 있게 한다(채팅 링크는 클릭이 안 되는 환경).
- Notion 작성 전 마크다운 스펙은 MCP 리소스 `notion://docs/enhanced-markdown-spec`를 따른다(표는 `<table>` XML 등 표준 MD와 다름).

---

## 알려진 기술 리스크 (계획에 반드시 반영, 잊지 말 것)

요구사항서·개념정리와 교차 검토에서 도출된 항목. 시간이 늘어나도 사라지지 않는 구조적 리스크다.

1. **Browser Item이 최대 난관이자 최고 배점(25점).** midibus(외부 SaaS) 상대 WebDriver 자동화는 본질적으로 불안정. **3 Step 먼저 견고화해 점수 확보 → 4~5 Step은 stretch.** 여기에 시간 버퍼를 의도적으로 배정.
2. **WebDriver/Selenium 컴포넌트 + `StartBrowserPollers` 누락 주의.** 요구사항서 docker-compose 서비스 목록(server/web/agent2/postgres/nginx)에 WebDriver가 없다. Browser Item은 WebDriver(예: `selenium/standalone-chrome`) + `StartBrowserPollers>0`가 있어야 동작 → **Day 1 compose에 미리 포함.**
3. **알림 파이프라인은 쉬운 대상(nginx)에서 먼저 검증.** `Media Type/Action`을 Browser Item보다 앞에 끝내고, `docker stop nginx`로 PROBLEM→알림→RESOLVED 전체 루프 + 장애/복구 스크린샷(산출물 6)을 먼저 확보.
4. **Browser 관련 Trigger 2종 별도 생성** (Browser Item 실행 실패 / Midibus 기능 검증 실패). Day 2의 "Trigger 3종"은 웹 시나리오용 최소 3개.
5. **트러블슈팅 로그를 Day 1부터 실시간 누적** (`TROUBLESHOOTING.md`). 요구사항: 최소 2건. 보고서·README의 핵심 재료.
6. **항목 Key의 시나리오명/Step명은 대소문자·공백까지 정확히 일치**해야 Trigger가 동작.
7. **일정:** 필수(Day 1~5 범위)에서 학습 속도를 깎지 말 것. 부족하면 **고도화(Day 6~10)를 드롭**해 흡수.

---

## 산출물 / 평가 기준 (요약)

필수 산출물 8종(전부 GitHub 커밋): ① Repo ② `docker-compose.yml`(`docker compose up -d` 단일 기동, `.env` 분리) ③ nginx 앱(`/`, `/health`→200+OK, `/status`) ④ Web Scenario XML Export(3 Step+) ⑤ Browser Item 설정·결과 ⑥ Trigger·Action + 장애/복구 스크린샷 ⑦ README.md ⑧ 결과보고서(A4 5p+).

평가 100점(70점↑ 완료): Browser Item **25** > Docker/WebScenario/Trigger 각 15 > nginx/README·보고서/알람 각 10. **Browser Item이 가장 무겁다.**

---

## 주요 공식 레퍼런스

> URL의 `/current/`는 최신 버전으로 리다이렉트된다. **실제 배포한 7.x 버전 문서를 보려면 `/7.0/` 등으로 고정**하고, 명령/설정 검증 시 버전 일치를 항상 확인할 것.

- Zabbix 매뉴얼(루트): https://www.zabbix.com/documentation/current/en/manual
- 컨테이너 설치: https://www.zabbix.com/documentation/current/en/manual/installation/containers
- 공식 Docker 이미지·compose 예시: https://github.com/zabbix/zabbix-docker
- Web monitoring(Web Scenario): https://www.zabbix.com/documentation/current/en/manual/web_monitoring
- Browser items: https://www.zabbix.com/documentation/current/en/manual/config/items/itemtypes/browser
- Triggers: https://www.zabbix.com/documentation/current/en/manual/config/triggers
- Trigger 함수 일람: https://www.zabbix.com/documentation/current/en/manual/appendix/functions
- 알림(Notifications)·Action: https://www.zabbix.com/documentation/current/en/manual/config/notifications
- Media types: https://www.zabbix.com/documentation/current/en/manual/config/notifications/media
- Server 설정 파라미터(`StartBrowserPollers` 등): https://www.zabbix.com/documentation/current/en/manual/appendix/config/zabbix_server
- 매크로 일람: https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location

---

## 프로젝트 관리

- 일정·작업은 Notion "Zabbix 모니터링 프로젝트" 페이지와 "Zabbix 작업 (Day별)" DB에서 관리(Claude가 MCP로 접근 가능).
- `private/` 디렉토리: 요구사항서·개념정리 등 원본 문서 보관. **git 미추적**(`.gitignore`에 포함).
