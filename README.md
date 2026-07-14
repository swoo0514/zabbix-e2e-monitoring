# Zabbix E2E 시나리오 기반 웹서비스 가용성 모니터링

Zabbix 7.0 LTS의 **Web Scenario**와 **Browser Item**으로 웹서비스의 E2E(End-to-End) 가용성을 감시하고, 장애 발생 시 **자동 알림(PROBLEM → RESOLVED)** 을 보내는 단일 Docker Compose 스택입니다. 서버·포트 확인을 넘어 **접속·로그인·메뉴 이동·데이터 조작**이 실제로 성공하는지를 사용자와 같은 경로로 검증합니다.

![운영 대시보드](images/img_19.png)

> 한 화면에서 현재 문제 · SLA · 성능 추세 · 인프라 상태를 확인하는 운영 대시보드.

- **감시 대상 ①** nginx 샘플 앱 — HTTP 다단계 체크(Web Scenario, 3 Step)
- **감시 대상 ②** midibus 웹서비스 — 실브라우저 시나리오(Browser Item, 5 Step)
- **알림** Slack / Email, 태그 기반 라우팅, 미확인 시 상향(에스컬레이션)
- **가용성 정량화** Services/SLA로 스텝별 가용성 %(SLO 99.5%)
- **배포** 단일 VM 위 `docker compose up -d`

> 설계 판단과 고도화의 상세 근거는 **[결과보고서](docs/결과보고서.md)** 에 정리했습니다.

---

## 목차

1. [개요](#1-개요)
2. [아키텍처](#2-아키텍처)
3. [사전 요구사항](#3-사전-요구사항)
4. [설치 및 기동](#4-설치-및-기동)
5. [Zabbix 초기 설정 가이드](#5-zabbix-초기-설정-가이드)
6. [E2E 시나리오 구조](#6-e2e-시나리오-구조)
7. [가용성 정량화 (Services / SLA)](#7-가용성-정량화-services--sla)
8. [관측 성숙도 고도화](#8-관측-성숙도-고도화)
9. [알림 및 운영 정비](#9-알림-및-운영-정비)
10. [장애 테스트](#10-장애-테스트)
11. [트러블슈팅](#11-트러블슈팅)
12. [산출물 대응표](#12-산출물-대응표)
13. [저장소 구조](#13-저장소-구조)

---

## 1. 개요

| 항목 | 내용 |
|---|---|
| 목적 | 서버 상태·포트 확인을 넘어 **실제 사용자 시나리오**로 서비스 품질을 검증하고, 장애를 자동 감지·통지 |
| 대상 | nginx 샘플 앱(Web Scenario) · midibus(Browser Item) |
| 핵심 기술 | Linux, Docker Compose, Zabbix 7.0 LTS, Nginx, Selenium(WebDriver) |
| 배포 | Cloud VM(Ubuntu 24.04) 단일 Docker Compose 스택 |

필수 산출물 8종을 모두 저장소에 커밋했으며, 산출물별 위치는 [12. 산출물 대응표](#12-산출물-대응표)에 정리했습니다.

---

## 2. 아키텍처

```mermaid
flowchart LR
  subgraph VM["단일 VM · Docker Compose · network zabbix-net"]
    web["zabbix-web<br>:8080 (외부 공개)"]
    server["zabbix-server<br>수집·트리거·알림"]
    db[("postgres 16<br>데이터/설정")]
    agent["zabbix-agent2<br>호스트·컨테이너 메트릭<br>(Docker 플러그인)"]
    sel["selenium<br>standalone-chrome :4444"]
    nginx["nginx 샘플앱<br>:80 (내부)"]
    server --- db
    web --- db
    server --- agent
    server -->|WebDriver| sel
    server -->|Web Scenario HTTP| nginx
    proxy["zabbix-proxy (profile)<br>store-and-forward 버퍼"] -.->|"수집 실행 이관"| nginx
    proxy -.->|"설정 폴링·업로드"| server
    server2["zabbix-server-2 (profile)<br>HA standby"] -.->|"같은 DB 공유"| db
  end
  admin["운영자 브라우저"] -->|":8080 만"| web
  sel -->|"실브라우저"| midibus["midibus (외부 SaaS)"]
  server -->|알림| notify["Slack / Email"]
```

**포트 정책** — 컨테이너가 호스트에 공개(publish)하는 서비스 포트는 **`8080`(Zabbix Web UI) 하나뿐**입니다. PostgreSQL(5432)·Server(10051)·Agent(10050)·Selenium(4444)·nginx(80)은 모두 내부 브리지(`zabbix-net`)로만 통신합니다. 관리용 SSH(22)는 서비스 스택과 별개로 Security Group에서 허용 IP 한정으로 개방합니다. 점선의 두 서비스(`zabbix-proxy`·`zabbix-server-2`)는 compose **profile**(proxy·ha)로 격리된 이중화 실험 구성으로, 기동해도 외부 노출은 변하지 않습니다([10.5 이중화 실측](#105-이중화-실측--zabbix-proxy--서버-ha) 참고).

**데이터 흐름** — ① Server가 nginx에 HTTP 요청(Web Scenario) / Selenium을 통해 midibus에 실브라우저 접속(Browser Item) → ② 결과를 PostgreSQL에 저장 → ③ Trigger가 판정(PROBLEM/RESOLVED) → ④ Action이 Slack/Email로 발송.

> 각 서비스·설정 키의 판단 근거(예: selenium `shm_size: 2gb`, agent2 Docker 소켓 마운트의 보안 트레이드오프)는 `docker-compose.yml` 주석과 [결과보고서 2장](docs/결과보고서.md)에 기록했습니다.

---

## 3. 사전 요구사항

| 항목 | 권장 |
|---|---|
| OS | Ubuntu 24.04 LTS (그 외 Linux 가능) |
| Docker Engine | 24.0 이상 |
| Docker Compose | v2 (`docker compose` 서브커맨드) |
| 메모리 | 4 GB 이상 (Selenium/Chrome이 `/dev/shm` 2GB 사용) |
| 네트워크 | 인바운드 `8080/tcp` 개방, 아웃바운드로 midibus 접근 가능 |

```bash
docker --version
docker compose version
```

---

## 4. 설치 및 기동

```bash
# 1) 클론
git clone <REPO_URL> zabbix-e2e-monitoring
cd zabbix-e2e-monitoring

# 2) 환경변수 파일 생성 후 값 채우기 (비밀번호는 반드시 강한 값으로)
cp .env.example .env
vi .env        # POSTGRES_PASSWORD 등 변경

# 3) 전체 기동 (단일 명령)
docker compose up -d

# 4) 상태 확인 — 기본 6개 서비스가 running 이어야 함 (proxy/ha 프로파일 서비스 2개는 평시 미기동)
docker compose ps
```

`.env` 주요 항목:

| 변수 | 용도 |
|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Zabbix DB 자격증명 |
| `PHP_TZ` | 프론트엔드 타임존(예: `Asia/Seoul`) |
| `ZBX_SERVER_NAME` | UI 상단 설치 이름 |
| `NGINX_SECURE_USER` / `NGINX_SECURE_PASS` | `/secure` Basic Auth(고도화) |

**Web UI 접속** — `http://<VM_IP>:8080`, 최초 계정 **`Admin` / `zabbix`** → **접속 즉시 비밀번호 변경**.

> `.env`에는 이중화 실험용 knob(히스토리 캐시 통제, HA 노드 식별자, 프록시 노드 나열)도 주석으로 문서화되어 있으며, 값을 넣지 않으면 공식 기본값이 적용되어 검증된 스택이 그대로 동작합니다. 실험 서비스 기동: `docker compose --profile proxy --profile ha up -d`.

---

## 5. Zabbix 초기 설정 가이드

전체 순서는 다음과 같습니다. 가장 빠른 경로는 **②의 XML 임포트**(호스트·시나리오·아이템·트리거 일괄)이며, 각 절의 수동 절차는 구조 이해용입니다.

| 순서 | 작업 | 절 |
|---|---|---|
| ① | 에이전트 인터페이스 조정 | 5.1 |
| ② | 호스트 일괄 등록 (XML 임포트) — 또는 수동 생성 | 5.2 |
| ③ | 매크로 실값 입력 (자격증명·허용 IP) | 5.2 |
| ④ | Web Scenario 확인/등록 + User-agent | 5.3 |
| ⑤ | Browser Item 스크립트 API 배포 | 5.4 |
| ⑥ | Dependent + Trigger 확인 | 5.5 |
| ⑦ | 알림 구성 (Media type → 사용자 미디어 → Action) | 5.6 |
| ⑧ | 설정 검증 체크 | 5.7 |

### 5.1 에이전트 인터페이스 조정 (컨테이너 분리 구성 필수)

기본 호스트 "Zabbix server"의 Agent 인터페이스가 `127.0.0.1`이면 별도 컨테이너의 agent에 도달하지 못합니다.
- `Data collection → Hosts → "Zabbix server" → Interfaces → Agent`
- **Connect to: DNS**, **DNS: `zabbix-agent2`**, Port `10050`

(상세: [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) #1)

### 5.2 Host 등록 — XML 임포트(권장) 또는 수동

**XML 임포트(권장)** — `Data collection → Hosts → Import` 버튼 → 아래 두 파일을 순서대로:

1. [`zabbix/export/zbx_export_hosts_nginx.xml`](./zabbix/export/zbx_export_hosts_nginx.xml) — nginx-sample 호스트 + Web Scenario(UA 포함) + 트리거 3종 + Nginx by HTTP 템플릿 링크
2. [`zabbix/export/zbx_export_hosts_midibus.xml`](./zabbix/export/zbx_export_hosts_midibus.xml) — midibus 호스트 + master/온디맨드 Browser Item + dependent 18종 + 트리거 11종(nodata·perf 포함)

**수동 생성 시:**

| Host | Host group | 용도 |
|---|---|---|
| `nginx-sample` | E2E Targets | Web Scenario 대상 |
| `midibus` | E2E Targets | Browser Item 대상 |

![nginx-sample Host 생성](images/img.png)

**③ 매크로 실값 입력(임포트 후 필수)** — `Data collection → Hosts → midibus → Macros` 탭:

| 매크로 | 타입 | 값 |
|---|---|---|
| `{$MIDIBUS.USER}` | Secret text | midibus 계정 ID |
| `{$MIDIBUS.PASS}` | Secret text | midibus 계정 비밀번호 |
| `{$VM.EGRESS_IP}` | Text | VM의 공인 egress IP (보안키 허용 IP — [TROUBLESHOOTING #5](./TROUBLESHOOTING.md)) |

> Secret 매크로는 export XML에 값이 포함되지 않으므로 임포트 후 반드시 직접 입력해야 합니다. 스크립트·export에 자격증명을 하드코딩하지 않는 이유입니다.

### 5.3 nginx Web Scenario 등록 (3 Step)

UI 경로: `Data collection → Hosts → nginx-sample 행의 Web → Create web scenario`

| 필드 | 값 | 근거 |
|---|---|---|
| Name | `nginx-availability` | 트리거 키의 시나리오명과 대소문자까지 일치해야 함 |
| Update interval | `1m` | 경량 HTTP 체크 — 빠른 감지 |
| Agent | `other ...` → `Zabbix-Monitor/1.0` | 요구사항 4.1(User-agent 명시). 접근 로그에서 모니터링 트래픽 식별용. API 일괄 적용: `bash zabbix/set-webscenario-agent.sh` |

Steps 탭에서 3단계 등록:

| Step | URL | 검증 |
|---|---|---|
| main | `http://nginx/` | 상태 200 + Required string `Welcome to nginx` |
| health | `http://nginx/health` | 상태 200 + Required string `OK` |
| status | `http://nginx/status` | 상태 200 또는 404 (요구사항 4.2 허용 범위) |

적용 확인 — nginx 접근 로그에 UA가 찍힙니다:

```bash
docker compose logs --since 2m nginx | grep -F 'Zabbix-Monitor/1.0'
# 172.18.x.x [..] "GET / HTTP/1.1" 200 0.000s "Zabbix-Monitor/1.0"
```

![Web Scenario Latest data](images/img_1.png)

### 5.4 midibus Browser Item 등록 (5 Step)

`midibus` 호스트 → Items → Create item.

| 필드 | 값 |
|---|---|
| Type | **Browser** |
| Key | `browser.midibus.e2e` |
| Parameters | `url`, `username`={$MIDIBUS.USER}, `password`={$MIDIBUS.PASS}, `allowed_ip`={$VM.EGRESS_IP} |
| Script | [`zabbix/midibus-browser-item.js`](./zabbix/midibus-browser-item.js) |
| Update interval | 10m 이상 (미디어 업로드·인코딩 비용) |

스크립트는 웹 에디터 붙여넣기 시 손상될 수 있어 **API로 배포**합니다(config-as-code):

```bash
ZBX_PASS='<admin_password>' bash zabbix/update-item-script.sh
```

> **전제** — Browser Item 동작에는 Selenium(WebDriver) + `StartBrowserPollers>0` + `WebDriverURL`이 필요하며, 본 스택은 `zabbix-server`에 이미 설정되어 있습니다. Step 4(보안키)는 미리 배포해둔 test 영상(fixture 채널)을 사용합니다.

### 5.5 Dependent Item + Trigger

master가 반환하는 JSON을 스텝별 숫자 item으로 분해(JSONPath)하고 각 스텝에 트리거를 겁니다. (구조는 [6.2](#62-midibus-browser-item--5-step) 참고)

- **Dependent item 생성** — `midibus` 호스트 → Items → Create: Type `Dependent item`, Master item `browser.midibus.e2e`, Preprocessing 탭에서 `JSONPath` = `$.steps.media` (+ `Custom on fail: Discard value`).
- **Trigger 생성** — `Data collection → Hosts → midibus → Triggers → Create`: Expression `last(/midibus/midibus.step.media)=0`, 태그 `service:midibus`·`step:media`, Dependencies 탭에서 로그인 트리거 지정(별형 의존).
- 전체 정의는 XML로 일괄 임포트 가능: `Data collection → Hosts → Import` → [`zabbix/export/zbx_export_hosts_midibus.xml`](./zabbix/export/zbx_export_hosts_midibus.xml)

![midibus dependent items](images/img_13.png)
![midibus 트리거](images/img_14.png)

### 5.6 알림 구성 (Media type → 사용자 미디어 → Action)

**Media type** — `Alerts → Media types`:

| 항목 | Email | Slack |
|---|---|---|
| 방식 | SMTP — 서버 `smtp.gmail.com`, 포트 `587`, 보안 `STARTTLS` | 7.0 내장 Media type — Bot token(`xoxb-…`) |
| 인증 | Gmail은 계정 비밀번호가 아니라 **2FA 앱 비밀번호** 필요 | 봇을 대상 채널에 **초대**해야 발송됨 |

**사용자 미디어** — `Users → Users → Admin → Media 탭 → Add`: Type(Email/Slack), Send to(주소/채널), When active `1-7,00:00-24:00`.

**Action** — `Alerts → Actions → Trigger actions → Create` (2개):

| Action | 조건 | Operations | Recovery | 에스컬레이션 |
|---|---|---|---|---|
| midibus alerts | `Tag service equals midibus` | Step 1: Slack | 복구 통지 ✅ | Step 2: Duration `30m` 경과·미확인(Ack 없음) 시 Email 상향 |
| nginx alerts | `Tag service equals nginx` | Email | 복구 통지 ✅ | — |

> 에스컬레이션 30분은 초기값입니다(온콜 정책 확정 시 대응 목표에 맞춰 조정). 검증은 duration을 2분으로 낮춰 수행 후 원복했습니다. Slack 열람·RESOLVED는 Ack이 아니며, 명시적 Acknowledge만 상향을 멈춥니다.

### 5.7 설정 검증 체크

1. `Monitoring → Latest data` — nginx-sample(web.test.*)·midibus(step 6종) 값이 주기대로 갱신되는가
2. `Monitoring → Problems` — 평시 0건인가 (남아 있으면 원인 확인)
3. 자격증명을 일부러 틀리게 → Slack 수신 → 복원 → RESOLVED 수신 ([10.3](#103-midibus--실행-실패와-기능-검증-실패-두-모드)의 축약판) — 알림 배관의 최종 확인
4. `Reports → Action log` — 발송 이력이 `Sent`인가

---

## 6. E2E 시나리오 구조

### 6.1 nginx Web Scenario — `nginx-availability`

연결 Trigger 3종:

| Trigger | 심각도 | Expression |
|---|---|---|
| Web scenario failed | High | `last(/nginx-sample/web.test.fail[nginx-availability])<>0` |
| Bad HTTP status (main) | High | `last(/nginx-sample/web.test.rspcode[nginx-availability,main])<>200` |
| Response time > 3s (main) | Warning | `last(/nginx-sample/web.test.time[nginx-availability,main,resp])>3` |

![nginx 트리거 3종](images/img_2.png)

### 6.2 midibus Browser Item — 5 Step (master + dependent)

브라우저는 master에서 **한 번만** 돌고(로그인 1회 → 5스텝 순차 → `finally`에서 생성 자원 역순 삭제), 스텝별 판정은 dependent item이 반환 JSON을 분해해 얻습니다. 실행은 1회, 관측은 스텝 수만큼입니다.

| Step | 동작 | 검증 |
|---|---|---|
| 1 로그인 | ID/PW → 로그인 | 계정 드롭다운 노출 |
| 2 카테고리 | 생성 → 채널 자동배포 → 삭제 | 단계별 성공 |
| 3 미디어 | 업로드 → 확인 → 삭제 → 확인 | 목록 반영 |
| 4 보안키 | 생성(유효시간·허용IP) → 배포URL 적용 → 재생 | 플레이어 재생 |
| 5 보조사용자 | 추가 → 권한 변경 → 삭제 | 목록 권한값 |

반환 JSON의 `steps.*`(1=성공/0=실패/2=스킵)를 dependent로 분해 → 스텝 트리거 6종 + 자가진단·성능 트리거. 트리거 의존은 로그인 중심 별형으로 구성됩니다([9. 운영 정비](#9-알림-및-운영-정비)).

| Trigger | 심각도 | Expression |
|---|---|---|
| midibus 로그인 실패 | High | `last(/midibus/midibus.step.login)=0` |
| midibus 미디어 실패 | High | `last(/midibus/midibus.step.media)=0` — 로그인에 의존 |
| 카테고리·보안키·보조사용자 실패 | Average | `last(/midibus/midibus.step.<X>)=0` — 로그인에 의존 |
| 자동배포 실패 | Average | `last(/midibus/midibus.step.deploy)=0` — 카테고리에 의존(값 오염이 실제 전파되는 유일한 체인) |
| 데이터 끊김(자가진단 층1) | Warning | `nodata(/midibus/browser.midibus.e2e,25m)=1` — 주기(10m) 2회 미도착+여유의 배수 설계 |
| 성능 열화(4종 대표) | Warning | `min(/midibus/midibus.perf.total,#3)>avg(/midibus/midibus.perf.total,7d)*2 and min(...,#3)>60` — 자기 이력 대비 2배 + 절대 하한 + 3회 연속의 3중 오탐 방지, `type:performance` 태그로 SLA 격리 |

값 2(스킵)는 `=0` 비교에 걸리지 않으므로 온디맨드 부분 실행이 오탐을 만들지 않습니다. 전체 정의는 [`zabbix/export/zbx_export_hosts_midibus.xml`](./zabbix/export/zbx_export_hosts_midibus.xml)에 있습니다.

**스크립트 고도화** — 검증된 5-Step 스크립트에 다음을 얹었습니다(상세: [결과보고서 4장](docs/결과보고서.md)).
- **스텝 격리** — 한 스텝이 실패해도 나머지 스텝은 계속 검사(블록별 예외 처리).
- **부분 실행(`only`)** — 특정 스텝만 골라 실행(온디맨드 아이템, 개발·점검용).
- **셀렉터 대체 + self-heal** — 화면 요소 변경 시 대체 셀렉터로 시나리오 유지하고 그 변경을 관측.
- **실패 원인 추적** — 어느 서브액션에서 실패했는지 특정 + 에러 유형 분류(셀렉터/타이밍/인프라/기능).

> **왜 스텝별 별도 Browser Item이 아닌가** — 스텝마다 별도 item은 로그인 N회 반복·세션 격리로 의존 스텝이 깨지고 외부 SaaS에 N배 부하가 갑니다. 비용 분석 후 기각하고 master+dependent를 채택했습니다.

---

## 7. 가용성 정량화 (Services / SLA)

트리거는 "지금 장애냐"만 답합니다. "지난 기간 가용률이 몇 %였나"를 답하기 위해 Services 트리와 SLA를 구성했습니다.
- **Services 구성** — `Services → Edit`: 상위 서비스 `midibus E2E`(하위 중 최악 롤업) + 스텝별 하위 서비스 6개. 각 하위 서비스의 Problem tags에 `step:<이름>` 매핑(최하위에만), 서비스 태그 `sla:midibus`.
- **SLA 구성** — `Services → SLA → Create`: SLO `99.5%`, 주기 Monthly, 스케줄 24×7, Service tags `sla=midibus`. 리포트는 `Services → SLA report`.
- 장애 주입으로 문제 → 서비스 상태 → SLA 다운타임 반영의 전 구간을 검증.

![SLA report](images/img_17.png)

> 억제(Maintenance)된 문제는 서비스 상태·SLA 계산에서 제외됨을 소스 코드까지 추적해 확인했습니다([결과보고서 6·10장](docs/결과보고서.md)).

---

## 8. 관측 성숙도 고도화

pass/fail 판정을 넘어, 모니터링 시스템의 성숙도를 다음으로 끌어올렸습니다.

| 항목 | 내용 |
|---|---|
| 모니터 자가진단 | 데이터 끊김 감지(`nodata`) + Zabbix 엔진 상태(폴러·큐·캐시) 감시 + 외부 감시 설계 |
| 성능 열화 감지 | 페이지 로드·전송 성능을 자기 이력 대비(평소의 2배)로 판정, 장애 전 예고 |
| 컨테이너 감시 | Docker 플러그인으로 컨테이너별 CPU·메모리(특히 selenium) 수집 |
| nginx 자체 지표 | 공식 "Nginx by HTTP" 템플릿으로 stub_status 14종 수집 |
| 운영 대시보드 | 현재 문제 · SLA · 성능 추세 · 인프라 상태를 한 화면으로 |

![성능 추세](images/img_18.png)

> 실측 인사이트 예: 시나리오 벽시계 약 26초, 평시 브라우저 폴러 duty 약 4.3%(단, 폴러 슬롯이 1개라 실병목은 실행이 겹칠 때의 직렬화), 부분 실행(`only=securitykey`) 약 9.9초. 상세는 [결과보고서 8장](docs/결과보고서.md).

---

## 9. 알림 및 운영 정비

### 9.1 알림 파이프라인
구성 절차·필드값은 [5.6 알림 구성](#56-알림-구성-media-type--사용자-미디어--action)에 정리했습니다. 요지: 태그(`service`)로 대상별 채널 분기(midibus→Slack, nginx→Email), 복구 통지 필수, 미확인 시 30분 후 Email 상향.

### 9.2 운영 정비
- **트리거 의존(별형)** — 로그인 실패 시 하위 스텝의 연쇄 알림을 억제. 동일 장애에 6건 → 1건으로 수렴.
- **에스컬레이션** — 미확인(Ack 없음)이 지속되면 이메일로 상향하는 2단 구성.
- **알림 메시지 강화** — 알림 제목에 실패 지점과 에러 유형을 표기.
- **점검창(Maintenance)** — 계획된 작업 중 알림 억제(서비스 상태·SLA도 함께 제외).

| 연쇄 알림 (억제 전) | 별형 억제 (후) |
|---|---|
| ![6건 동시](images/img_21.png) | ![1건 수렴](images/img_22.png) |

---

## 10. 장애 테스트

각 시나리오는 **유발 방법(명령) → 기대 결과 → 복구 → 증빙** 순으로 재현할 수 있습니다.

### 10.1 nginx — 컨테이너 중단/재기동 (전체 다운)

```bash
docker stop zbx-nginx-app     # 장애 유발
docker start zbx-nginx-app    # 복구
```

**기대 결과** — 다음 수집 주기(≤1분)에 `Web scenario failed` **PROBLEM**(High) 발생 → Action이 Email/Slack 발송 → 재기동 후 자동 **RESOLVED** + 복구 알림. `Monitoring → Problems`에서 전환 확인.

![docker stop/start](images/img_8.png)

| PROBLEM | RESOLVED | Slack 알림 |
|---|---|---|
| ![PROBLEM](images/img_3.png) | ![RESOLVED](images/img_5.png) | ![Slack](images/img_16.png) |

이메일 알림(PROBLEM/RESOLVED)과 Action log:

![Email PROBLEM](images/img_10.png)
![Email RESOLVED](images/img_9.png)

### 10.2 nginx — 부분 장애: 응답코드 이상 · 응답시간 초과

전체 다운이 아닌 부분 장애 두 유형은 **어떤 트리거가 발동하고 어떤 트리거가 침묵하는지**가 관전 포인트입니다.

**(a) 응답코드 이상** — 의도적으로 500을 반환하는 `/fail` 엔드포인트로 재현.

- **발동:** `Bad HTTP status`(`rspcode<>200`) / **침묵:** 응답시간 트리거(응답은 빠르게 도달) — "죽음"과 "이상 응답"을 구분하는 판정 계층. 증빙: ![응답코드 이상](images/img_4.png)

**(b) 응답시간 초과** — 재현 예시: nginx main location에 대역 제한을 임시 적용 후 reload.

```bash
# nginx/conf.d/default.conf 의 location / 에 임시 추가:  limit_rate 2k;
docker compose exec nginx nginx -t && docker compose exec nginx nginx -s reload
# 복구: 해당 줄 제거 후 다시 reload
```

- **발동:** `Response time > 3s`(Warning) / **침묵:** `Web scenario failed`(응답이 느릴 뿐 성공 — 단 Step Timeout(기본 15s)을 넘기면 실패로 전환되므로 제한값을 과하게 잡지 않기). 트리거 발동 자체는 산출물 6 검증 당시 확인: ![응답시간 초과](images/img_6.png)

### 10.3 midibus — 실행 실패와 기능 검증 실패 (두 모드)

요구사항의 Browser 관련 트리거 2종(실행 실패 / 기능 검증 실패)을 구분해 검증합니다.

**(a) 실행 실패 — 자격증명 오설정.** `Data collection → Hosts → midibus → Macros` → `{$MIDIBUS.PASS}`를 잠깐 틀린 값으로 변경 → 다음 실행(10분 주기, 온디맨드로 즉시 가능) 후 값 복원.

- **기대 결과** — 로그인 스텝 트리거 **1건만** PROBLEM(하위 5개 스텝은 별형 의존으로 억제, 6건→1건 수렴) → Slack 통지 제목에 실패 지점·유형 표기(`[selector: login success marker]`) → 복원 후 RESOLVED.

![midibus RESOLVED](images/img_15.png)

**(b) 기능 검증 실패 — 특정 스텝만 파손.** 로그인은 성공하는데 특정 기능만 깨진 상황을 `fault.js`(category 강제 파손)로 재현.

- **기대 결과** — **실행은 성공**하지만 `category`·`deploy`=0으로 판정, `media`·`securitykey`·`subuser`는 1로 **계속 검사됨**(스텝 격리) — `failed_step`=2(실패 스텝 순번), `errors.category`에 원인 기록. 즉 "스크립트가 죽었다"와 "기능이 깨졌다"가 다른 트리거로 갈립니다.
- 스텝 격리가 없던 구조라면 category 이후 전 스텝이 미검사로 남았을 것 — 격리 설계의 검증이기도 합니다([결과보고서 4.6장](docs/결과보고서.md)).

### 10.4 모니터 자가진단 — 수집 엔진 중단

```bash
docker stop zbx-selenium      # WebDriver 중단 → Browser Item 데이터 끊김
docker start zbx-selenium     # 복구
```

**기대 결과** — 스텝 트리거는 침묵하지만(마지막 성공값 유지 — `last()`의 함정), 약 25분 후 **`nodata` 트리거**가 데이터 끊김 자체를 PROBLEM으로 판정 → Slack 통지 → 데이터 복귀 시 RESOLVED. "데이터가 끊겼는데 정상으로 보고하는" 최악 실패 유형에 대한 방어를 검증합니다.

### 10.5 이중화 실측 — Zabbix Proxy · 서버 HA

compose profile로 격리된 이중화 구성의 실측 결과입니다(방법·해석: [결과보고서 11장](docs/결과보고서.md)).

| 실험 | 방법 | 실측 결과 |
|---|---|---|
| 서버 정전 버퍼링 | `docker stop zbx-server` 5분 56초 + 정속 송신 | 프록시 경유 **300/300 무손실**, 재기동 후 원 타임스탬프로 backfill |
| 캐시 포화 부하 | 캐시 128K 축소 + 2000 msg/s 버스트 | **유실 0** — 서버는 값을 버리지 않고 수용을 늦춤(backpressure) |
| HA failover | active 노드 `docker stop` / `docker kill` | standby 자동 승격 — 정상 종료 **3.6초**, 크래시 **16.6초** |
| HA+프록시 결합 | failover 진행 중 프록시 경유 정속 송신(초당 1건) | **180/180 무손실** — 승격까지의 공백을 프록시 버퍼가 보완 |

| 서버 중단 구간 — 프록시 경유(연속) | 결합 실험 — failover 중 무손실 |
|---|---|
| ![프록시 backfill](images/img_31.png) | ![E4 무손실](images/img_46.png) |

재현 절차:

```bash
# 1) 실험 서비스 기동 (기본 스택 무변경 — profile 격리)
docker compose --profile proxy --profile ha up -d

# 2) 프록시 등록 + nginx-sample 호스트 전환 + 부하 랩 호스트 생성 (멱등, delete로 원상복구)
ZBX_PASS='<admin_password>' bash zabbix/provision-proxy-lab.sh

# 3) 프록시 상태 확인 — UI: Administration → Proxies (Last seen 수 초 이내)
#    HA 상태 확인 — active 노드에서:
docker exec zbx-server zabbix_server -R ha_status

# 4) 부하 스윕(레이트·시간 지정) / 저장 개수 검증
bash zabbix/burst-sweep.sh proxy 1000
ZBX_PASS='<admin_password>' bash zabbix/count-history.sh burst.proxy 120

# 5) 원상복구 — 실험 서비스만 정지·제거 (기본 6서비스는 유지)
ZBX_PASS='<admin_password>' bash zabbix/provision-proxy-lab.sh delete
docker compose --profile proxy --profile ha rm -sf zabbix-proxy zabbix-server-2
# 주의: `--profile ... down`은 기본 서비스까지 내리므로 사용하지 않습니다.
# HA를 켰던 경우 .env의 ZBX_HANODENAME1/ZBX_NODEADDRESS1 등을 비운 뒤 `docker compose up -d`로 standalone 복귀.
```

---

## 11. 트러블슈팅

전체 기록은 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)(10건). 대표 사례:
- **#1** 컨테이너 분리 환경의 "agent not available" — 인터페이스를 IP가 아닌 서비스명 DNS로.
- **#2** nginx `return` vs `auth_basic` — `return`은 access(auth) 단계를 건너뛴다 → `alias` 파일 서빙.
- **#3** Browser Item 정석 API 오판 — 대기/alert API는 전용 objects 페이지에 있다(요약본 신뢰 금지).
- **#8** 점검 중 억제된 문제가 서비스/SLA에서 제외됨을 소스 코드까지 추적해 확정.
- **#9** 5분 56초 정전을 "아무도 못 봤다" — 관측은 수집 주기(장애 < 주기면 투명)·실행 주체·backfill 여부에 종속. "그래프 공백 없음 ≠ 무장애".
- **#10** 도착이 지연되는 시스템에서 슬라이딩 시간창 카운트는 유실처럼 보이는 착시를 만든다 — 총량은 고정 버킷 집계로, 완주는 시퀀스 최댓값으로.

---

## 12. 산출물 대응표

| # | 산출물 | 위치 |
|---|---|---|
| ① | Repo | 본 저장소 |
| ② | docker-compose.yml (.env 분리) | [`docker-compose.yml`](./docker-compose.yml) · [`.env.example`](./.env.example) |
| ③ | nginx 앱 (`/`·`/health`·`/status`) | [`nginx/`](./nginx) |
| ④ | Web Scenario XML Export | [`zabbix/export/`](./zabbix/export) |
| ⑤ | Browser Item 설정·결과 | [`zabbix/midibus-browser-item.js`](./zabbix/midibus-browser-item.js) · `zabbix/export/` |
| ⑥ | Trigger·Action + 장애/복구 스크린샷 | [12.1 장애·복구 증빙 이미지](#121-장애복구-증빙-이미지) · 재현 절차: [10. 장애 테스트](#10-장애-테스트) |
| ⑦ | README | 본 문서 |
| ⑧ | 결과보고서 | [`docs/결과보고서.md`](docs/결과보고서.md) |

추가 제출물: 발표자료 — [`docs/발표자료.pdf`](docs/발표자료.pdf)

### 12.1 장애·복구 증빙 이미지

산출물 ⑥의 핵심 증빙을 단계별로 특정한 목록입니다. 전체 이미지는 [`images/`](./images) 참고.

| 단계 | 파일 | 내용 |
|---|---|---|
| 트리거 정의 | [`img_2`](images/img_2.png) · [`img_14`](images/img_14.png) | nginx 트리거 3종(+`check`/`service` 태그) · midibus 트리거 4종(`service:midibus`) |
| 트리거 의존성 | [`img_26`](images/img_26.png) · [`img_27`](images/img_27.png) | 로그인을 부모로 두는 별형 Depends on 재편(알림 6건→1건의 근거) |
| 장애 유발 | [`img_8`](images/img_8.png) | `docker stop/start` 터미널 — 장애 재현 방법 |
| PROBLEM 발생 | [`img_3`](images/img_3.png) · [`img_4`](images/img_4.png) · [`img_6`](images/img_6.png) | Web scenario failed → +Bad HTTP status(2건) → Response time>3s(Warning) |
| RESOLVED 복구 | [`img_5`](images/img_5.png) · [`img_7`](images/img_7.png) · [`img_15`](images/img_15.png) | nginx 2건 RESOLVED → 3건 전부 RESOLVED → midibus 4종 RESOLVED |
| Email 알림 | [`img_10`](images/img_10.png) · [`img_9`](images/img_9.png) · [`img_11`](images/img_11.png) | PROBLEM 수신 → RESOLVED 수신("Resolved in 1m 0s") → Action log Sent 기록 |
| Slack 알림 | [`img_16`](images/img_16.png) · [`img_22`](images/img_22.png) · [`img_21`](images/img_21.png) | PROBLEM+RESOLVED 메시지 → P→R 페어(1m12s) → fault injection 시 6종 연쇄 |

---

## 13. 저장소 구조

```
.
├─ docker-compose.yml            # 전체 스택 (server·web·agent2·postgres·selenium·nginx)
├─ .env.example                  # 환경변수 템플릿
├─ nginx/
│  ├─ conf.d/default.conf        # / · /health · /status (+ /secure · /fail)
│  ├─ html/index.html            # 메인 페이지 (Required String)
│  └─ auth/                      # Basic Auth 자격 (고도화)
├─ zabbix/
│  ├─ midibus-browser-item.js    # Browser Item 5-Step 스크립트
│  ├─ update-item-script.sh      # 스크립트를 Zabbix API로 배포 (config-as-code)
│  ├─ set-webscenario-agent.sh   # Web Scenario User-agent 설정 (요구 4.1)
│  ├─ get-last-result.sh         # 마스터 반환 JSON 조회 (검증)
│  ├─ flaky-rate.sh              # 스텝별 성공률 집계
│  ├─ provision-burst-lab.sh     # 부하 실험 랩 프로비저닝 (burst-lab 호스트·trapper)
│  ├─ provision-proxy-lab.sh     # 프록시 등록·호스트 전환·티어다운 (10.5)
│  ├─ burst-sweep.sh             # 레이트 스윕 부하 발생기 (10.5)
│  ├─ count-history.sh           # 저장 개수 조회 (유실 판정)
│  └─ export/                    # Web Scenario / Browser Item XML Export (산출물 ④⑤)
├─ scripts/gen-htpasswd.sh       # /secure Basic Auth 자격 파일 생성
├─ images/                       # 증빙 스크린샷 (산출물 ⑥)
├─ docs/결과보고서.md            # 결과보고서 (산출물 ⑧, docx 병행)
├─ testdata/beach.mp4            # 미디어 업로드 테스트 파일
├─ TROUBLESHOOTING.md            # 트러블슈팅 10건
└─ README.md
```

### 13.1 스크립트 레퍼런스

모든 `zabbix/*.sh`는 VM(스택이 기동된 호스트)에서 실행하며, Zabbix API 인증이 필요한 것은 `ZBX_PASS` 환경변수로 관리자 비밀번호를 받습니다(공통 옵션: `ZBX_URL`, `ZBX_USER`). 실행 전 `jq` 필요.

| 스크립트 | 용도 | 사용 예 |
|---|---|---|
| `update-item-script.sh` | Browser Item JS를 API(`item.update`)로 배포 — 웹 에디터 손상 우회, config-as-code | `ZBX_PASS='…' bash zabbix/update-item-script.sh` (옵션 `ZBX_KEYS`로 복수 키, `ZBX_SCRIPT`로 임시본 배포) |
| `set-webscenario-agent.sh` | Web Scenario User-agent를 `Zabbix-Monitor/1.0`으로 설정(요구 4.1) | `ZBX_PASS='…' bash zabbix/set-webscenario-agent.sh` |
| `get-last-result.sh` | master 반환 JSON 최근값 조회(steps/err/perf/raw) — 시나리오 검증용 | `ZBX_PASS='…' bash zabbix/get-last-result.sh steps` |
| `flaky-rate.sh` | 스텝별 실행 이력(1/0/2)을 집계해 성공률 산출 | `ZBX_PASS='…' bash zabbix/flaky-rate.sh` (기본 7일 창) |
| `provision-burst-lab.sh` | 부하 실험용 격리 호스트(`burst-lab`)·trapper 아이템 멱등 생성 / `delete`로 티어다운 | `ZBX_PASS='…' bash zabbix/provision-burst-lab.sh [delete]` |
| `provision-proxy-lab.sh` | 프록시 등록(`proxy.create`) → nginx-sample 프록시 이관 → `burst-lab-proxy` 생성 / `delete`로 역순 원상복구 | `ZBX_PASS='…' bash zabbix/provision-proxy-lab.sh [delete]` |
| `burst-sweep.sh` | 지정 경로(직접/프록시)로 R msg/s × DUR초 부하 송신 + sender 실패 집계 | `bash zabbix/burst-sweep.sh server 1000` / `proxy 2000 60` |
| `count-history.sh` | 아이템 저장 개수·최댓값 조회(유실 = 송신 − 저장 판정) | `ZBX_PASS='…' bash zabbix/count-history.sh burst.proxy 120` |
| `scripts/gen-htpasswd.sh` | `/secure` Basic Auth 자격 파일(.htpasswd) 생성 | `bash scripts/gen-htpasswd.sh` (`.env`의 NGINX_SECURE_* 사용) |

> 부하·측정 도구 3종(burst-sweep / count-history / flaky-rate)의 해석 주의점: 도착이 지연되는 조건에서는 시간창 계측이 총량을 과소평가할 수 있습니다 — 총량 판정은 고정 구간 집계, 완주 판정은 시퀀스 최댓값 기준([TROUBLESHOOTING #10](./TROUBLESHOOTING.md)).

> 고도화 작업의 상세 로그·설계 결정 원본은 `private/`(git 미추적)에 보관합니다. 본 저장소는 그 핵심을 공개 가능한 범위에서 정리한 것입니다.
