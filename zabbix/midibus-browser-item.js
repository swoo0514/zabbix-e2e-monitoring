/*
 * midibus Browser Item - E2E scenario (Zabbix 7.0 Browser item)
 * -----------------------------------------------------------------------------
 * Host: midibus / key: browser.midibus.e2e (+ browser.midibus.ondemand) / Type: Browser / Timeout 300s
 * Params: username={$MIDIBUS.USER} password={$MIDIBUS.PASS} url=https://midibus.kinxcdn.com/login
 *         allowed_ip={$VM.EGRESS_IP}  (Secret 매크로 — 보안키 허용 IP. 비면 IP 제한 없음, 있으면 그 IP로 제한)
 *         only=<block[,block]>  (선택. 예: "securitykey", "media,subuser". 미설정=전체 실행.
 *                                login은 항상 실행. "deploy"는 "category"의 별칭.
 *                                운영 아이템에는 절대 설정하지 않는다 - 온디맨드 전용)
 * 선행: selenium 컨테이너 /testdata/beach.mp4 (compose 마운트)
 * 배포: zabbix/update-item-script.sh (API push. ZBX_KEYS로 대상 키 지정 가능)
 *
 * 구조:
 *  - 스텝 격리: login(치명, 실패 시 전체 중단) 외 4개 블록(category/media/subuser/securitykey)은
 *    runBlock()의 개별 try/catch로 격리 - 한 블록이 죽어도 나머지는 계속 검사된다.
 *    블록별 에러는 result.errors.<block>={at,class,msg}, 최초 에러만 steps.err*로 승격(기존 dependent 호환).
 *  - 셀렉터 폴백: find/findX의 sel에 배열을 주면 후보를 라운드로빈(2s 프로브, 총예산 10s)으로 시도.
 *    1순위가 아닌 후보로 성공하면 healed에 기록(= UI 드리프트 신호). healed_count는 항상 반환(0 포함).
 *    주의: 커스텀 implicit wait 구간(업로드 60s)에는 배열 셀렉터 금지(프로브가 예산을 덮어씀).
 *  - steps 값: 1=성공, 0=실패, 2=스킵(only로 제외됨. last()=0 트리거에 안 걸리는 값).
 *
 * 정석 API (레퍼런스: manual/config/items/preprocessing/javascript/browser_item_javascript_objects):
 *  - setElementWaitTimeout : findElement 암묵적 대기(요소 '존재' 대기 -> 수동 폴링 제거)
 *  - unhandledPromptBehavior=accept : 네이티브 confirm 자동 수락(표준 W3C capability)
 *  - collectPerfEntries(mark): 스텝별 성능 마크
 *  - setError / BrowserError: 구조화된 에러
 *  - getProperty            : 체크박스 실시간 상태
 * 주의: implicit wait는 '가림(click intercepted)'은 못 푼다 -> click()에서 가림일 때만 재시도.
 */
var WAIT_MAIN = 10000;   // 기본 implicit wait
var WAIT_PROBE = 2000;   // 폴백 배열 프로브용 짧은 wait

var opts = Browser.chromeOptions();
opts.capabilities.alwaysMatch.unhandledPromptBehavior = "accept";
var browser = new Browser(opts);
browser.setScreenSize(1920, 1600);   // 하단 고정 푸터(#midibusFooter)가 저장 버튼을 덮음 -> 뷰포트 높여 버튼을 푸터 밖으로
browser.setSessionTimeout(30000);
browser.setElementWaitTimeout(WAIT_MAIN);

var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };
var result;

var crumb = "";       // 마지막으로 시도한 서브액션(요소 접근 name) — 실패 지점 특정용(find/findX 진입 시 갱신)
var foundSel = "";    // 마지막 find()가 실제로 매치시킨 셀렉터(배열 폴백 대응 — click/type 재시도의 re-find용)
var errors = {};      // 블록별 에러 상세 { at, class, msg }
var healed = {};      // self-heal 기록: name -> 성공한 비1순위 셀렉터
var healedCount = 0;
var only = null;      // null=전체 실행 / 배열=해당 블록만 (login은 항상)
var stepSec = {};     // 스텝 블록별 벽시계 소요(초). perf 마크는 "페이지 로드" 시간이라 스텝 시간이 아님(#3에서 확인)
var lapT = Date.now();
function lap(k) { stepSec[k] = Math.round((Date.now() - lapT) / 100) / 10; lapT = Date.now(); }

function classify(msg) {   // 에러 분류: 셀렉터 드리프트 / 타이밍 flaky / 인프라 / 기능 장애 후보
  var ml = msg.toLowerCase();
  return ml.indexOf("not found") >= 0 ? "selector"
    : (ml.indexOf("intercepted") >= 0 || ml.indexOf("interactable") >= 0) ? "timing"
    : (ml.indexOf("session") >= 0 || ml.indexOf("webdriver") >= 0 || ml.indexOf("resolve") >= 0 || ml.indexOf("timeout") >= 0) ? "webdriver"
    : "logic";
}

function findAny(by, sel, name) {
  crumb = name;
  if (typeof sel === "string") {           // 단일 셀렉터: 기존 동작 그대로 (implicit wait = WAIT_MAIN)
    foundSel = sel;
    var el = browser.findElement(by, sel);
    if (el === null) { throw Error("not found: " + name + " (" + sel + ")"); }
    return el;
  }
  // 배열: 라운드로빈 프로브. 총예산 WAIT_MAIN 안에서 후보들을 WAIT_PROBE씩 반복 순회.
  // 1순위를 매 바퀴 다시 시도하므로 "느린 페이지 + 멀쩡한 1순위"가 가짜 heal로 기록될 확률을 낮춘다.
  var deadline = Date.now() + WAIT_MAIN;
  browser.setElementWaitTimeout(WAIT_PROBE);
  try {
    do {
      for (var i = 0; i < sel.length; i++) {
        var e2 = browser.findElement(by, sel[i]);
        if (e2 !== null) {
          foundSel = sel[i];
          if (i > 0) { healed[name] = sel[i]; healedCount++; }   // 폴백으로 성공 = 드리프트 신호
          return e2;
        }
      }
    } while (Date.now() < deadline);
  } finally { browser.setElementWaitTimeout(WAIT_MAIN); }
  throw Error("not found: " + name + " (" + sel.join(" | ") + ")");
}
function find(sel, name)  { return findAny("css selector", sel, name); }
function findX(xp, name)  { return findAny("xpath", xp, name); }

function gone(sel, waitMs) {             // 짧은 대기로 '부재' 확인
  browser.setElementWaitTimeout(waitMs || 2000);
  var el = browser.findElement("css selector", sel);
  browser.setElementWaitTimeout(WAIT_MAIN);
  return el === null;
}
function click(sel, name) {              // 존재는 implicit wait, '가림/미준비'일 때만 재시도
  var el = find(sel, name);
  var rsel = foundSel;                   // 실제 매치된 셀렉터(배열이었을 수 있으므로 re-find는 이걸로)
  for (var i = 0; i < 15; i++) {
    try { el.click(); return; }
    catch (e) {
      var msg = "" + e;
      if (msg.indexOf("intercepted") < 0 && msg.indexOf("interactable") < 0) { throw e; }   // 가림/미준비 외 에러는 즉시
      Zabbix.sleep(300);
      var re = browser.findElement("css selector", rsel);
      if (re !== null) { el = re; }
    }
  }
  try { el.click(); } catch (ef) { throw Error(name + ": " + ef); }   // 마지막 시도 실패 시 이름 포함
}
function type(sel, txt, name) {          // 존재는 implicit wait, '아직 상호작용 불가(모달 애니메이션 등)'면 재시도
  var el = find(sel, name);
  var rsel = foundSel;
  for (var i = 0; i < 20; i++) {
    try { el.sendKeys(txt); return; }
    catch (e) {
      if (("" + e).indexOf("interactable") < 0) { throw e; }
      Zabbix.sleep(300);
      var re = browser.findElement("css selector", rsel);
      if (re !== null) { el = re; }
    }
  }
  try { el.sendKeys(txt); } catch (ef) { throw Error(name + ": " + ef); }
}

function wants(b) { return only === null || only.indexOf(b) >= 0; }

function runBlock(name, fn) {            // 블록 격리: only 게이트 + 개별 try/catch
  if (!wants(name)) {
    steps[name] = 2;                     // 2=스킵 (0/1과 구분, last()=0 트리거에 안 걸림)
    if (name === "category") { steps.deploy = 2; }
    return;
  }
  try { fn(); }
  catch (e) {
    var m = "" + (e && e.message ? e.message : e);
    errors[name] = { at: crumb, class: classify(m), msg: m };
    lap(name);                                    // 실패한 블록의 소요시간도 기록
    browser.setElementWaitTimeout(WAIT_MAIN);     // 블록 내에서 올린 wait(업로드 60s)이 남지 않게 복원
  }
}

try {
  var params = JSON.parse(value);
  if (params.only) {                     // 온디맨드 부분 실행 (운영 아이템엔 미설정)
    only = ("" + params.only).split(",");
    for (var oi = 0; oi < only.length; oi++) {
      only[oi] = only[oi].replace(/^\s+|\s+$/g, "");
      if (only[oi] === "deploy") { only[oi] = "category"; }   // deploy는 category 블록 내부
    }
  }

  // Step 1: 로그인 — 치명 블록(세션 전제). 실패 시 바깥 catch로 전체 중단.
  browser.navigate(params.url);
  find("#username", "username").sendKeys(params.username);
  find("#password", "password").sendKeys(params.password);
  click("#midibusLoginBtn", "login button");
  find("#accountDropdownBtn", "login success marker");
  steps.login = 1;
  browser.collectPerfEntries("login");
  lap("login");

  // Step 2: 카테고리 생성 -> 자동배포 -> 삭제
  runBlock("category", function () {
    browser.navigate("https://midibus.kinxcdn.com/config");
    click("#categoryTab-tab", "category tab");

    if (gone('#allCategories a[title="zbx-e2e-test"]', 3000)) {
      click("#menu_media_icon", "media menu");
      click("#addCategoryBtn", "add category button");
      var nameInput = find("#newCategoryName", "category name input");
      nameInput.clear();
      nameInput.sendKeys("zbx-e2e-test");
      click('button[onclick="createNewCategory()"]', "create category button");
      browser.navigate("https://midibus.kinxcdn.com/config");
      click("#categoryTab-tab", "category tab (after create)");
    }

    click('#allCategories a[title="zbx-e2e-test"]', "category link");
    steps.category = 1;
    browser.collectPerfEntries("category-create");

    var chk = find("#autoDistribution", "auto distribution checkbox");
    var checked = chk.getProperty("checked");
    if (checked !== true && checked !== "true") { click("#autoDistribution", "auto distribution checkbox"); }
    click("#categoryConfigSaveBtn", "category save button");
    steps.deploy = 1;
    browser.collectPerfEntries("category-deploy");

    click("#deleteCategoryBtn", "delete category button");   // confirm 자동 수락
    browser.collectPerfEntries("category-delete");
    lap("category");   // Step 2 전체(생성+자동배포+삭제) — deploy는 이 블록에 포함
  });

  // Step 3: 미디어 업로드 -> 확인 -> 삭제
  runBlock("media", function () {
    browser.navigate("https://midibus.kinxcdn.com/config");   // 격리: 블록 시작 상태를 명시적으로 리셋
    click(".fileUploadBtn", "media upload button");
    find('.qq-upload-button input[type="file"]', "file input").sendKeys("/testdata/beach.mp4");
    click("#trigger-upload", "upload start button");

    browser.setElementWaitTimeout(60000);                     // 업로드+인코딩 대기 (이 구간엔 배열 셀렉터 금지)
    find(".qq-upload-list li.qq-upload-success", "upload success");
    browser.setElementWaitTimeout(WAIT_MAIN);
    browser.collectPerfEntries("media-upload");

    browser.navigate("https://midibus.kinxcdn.com/media");
    var nameDiv = findX("//div[contains(@id,'mediaName_') and contains(text(),'beach.mp4')]", "uploaded media in list");
    steps.media = 1;

    var chkId = nameDiv.getAttribute("id").replace("mediaName_", "mediaCheck_");
    click("#" + chkId, "media checkbox");
    find("#mediaActionSelector", "media action selector").sendKeys("삭제");   // change -> confirm 자동 수락
    browser.collectPerfEntries("media-delete");
    lap("media");      // Step 3 전체(업로드+인코딩 대기+확인+삭제)
  });

  // Step 5: 보조사용자 추가 -> 권한 변경 -> 삭제 (요구 스펙 4.3)
  runBlock("subuser", function () {
    var subEmail = "zbx-e2e-" + Date.now() + "@e2e-test.com";   // 매번 고유
    browser.navigate("https://midibus.kinxcdn.com/subUsers");
    click("#editPlaylistBtn", "보조사용자 추가");
    Zabbix.sleep(1500);                                          // 모달 렌더 대기
    click("#userRoleSelector", "등급 select");                  // 이 select은 sendKeys 거부 -> 클릭으로 선택
    click("#userRoleSelector option[value=\"USER\"]", "등급=사용자");
    click("#showStatToSubuser_0", "분석권한 없음");             // 라디오/연락처 먼저 -> 이름 keyup에서 전체 재검증
    click("#showSettingsToSubuser_0", "설정권한 없음");
    type("#subUserEmail", subEmail, "이메일");
    type("#subUserPassword", "Zbxe2e!234", "비밀번호");
    type("#subUserPasswordCheck", "Zbxe2e!234", "비밀번호 확인");
    type("#subUserPhone", "01000000000", "연락처");
    type("#subUserName", "zbx-e2e-subuser", "이름");            // 마지막 keyup -> 전체 검증 -> disabled 해제
    click("#saveSubUserInfoBtn", "저장");                       // confirm 자동수락
    browser.collectPerfEntries("subuser-create");
    // --- 권한 변경: 새로고침 -> 행 클릭(편집) -> 분석 조회 권한 없음->모든 -> 저장 ---
    browser.navigate("https://midibus.kinxcdn.com/subUsers");
    findX("//tr[contains(.,'" + subEmail + "')]//td[contains(@aria-describedby,'subUserList_email')]", "보조사용자 행(편집)").click();   // 행 클릭 -> 편집 모달
    Zabbix.sleep(1500);
    click("#showStatToSubuser_1", "분석권한=모든 카테고리와 채널");   // 권한 변경
    find("#subUserName", "이름").clear();
    type("#subUserName", "zbx-e2e-subuser", "이름 재입력");           // keyup -> 재검증(저장 활성화)
    click("#saveSubUserInfoBtn", "저장");
    browser.collectPerfEntries("subuser-perm");
    // --- 변경 확인: 새로고침 후 분석 조회 권한 셀이 '모든...'인지 ---
    browser.navigate("https://midibus.kinxcdn.com/subUsers");
    var statCell = browser.findElement("xpath", "//tr[contains(.,'" + subEmail + "')]//td[contains(@aria-describedby,'subUserList_statAnalysis')]");
    if (statCell !== null && ("" + statCell.getText()).indexOf("모든") >= 0) { steps.subuser = 1; }   // 추가+권한변경 확인
    // --- 삭제 (null 허용: 확인 실패 시에도 정리는 시도) ---
    var subDel = browser.findElement("xpath", "//tr[contains(.,'" + subEmail + "')]//img[contains(@onclick,'deleteSubUser')]");
    if (subDel !== null) { subDel.click(); browser.collectPerfEntries("subuser-delete"); }   // 삭제(confirm 자동수락)
    lap("subuser");    // Step 5 전체(추가+권한변경+확인+삭제)
  });

  // Step 4: 보안키 생성 -> 배포 URL 적용 -> 그 URL로 재생 검증 (fixture: ch_19f2748f 배포 영상)
  runBlock("securitykey", function () {
    browser.navigate("https://midibus.kinxcdn.com/channel/ch_19f2748f");
    click("#mediaName_19f26bae944f04b4", "fixture 영상 선택");                        // 행 선택 -> 우측 사이드바
    click('button[data-bs-target="#createSecurePlayKeyLayer"]', "보안키 생성 버튼");   // 모달 열기
    Zabbix.sleep(1000);
    click("#quickBtn_1day", "유효시간 1일");                                          // 시간(필수) -> createKeyBtn 활성화
    type("#tokenSecurity_allowedIP", "" + (params.allowed_ip || ""), "허용 IP(VM)");   // Secret 매크로 {$VM.EGRESS_IP}에서 주입(하드코딩 제거). 비면 무제한, 있으면 그 IP로 제한(재생 요청 IP와 일치해야 재생됨)
    click("#createKeyBtn", "재생 키 생성");
    click("#applyShareUrlBtn", "배포 URL에 적용");
    browser.collectPerfEntries("securitykey-create");
    var playUrl = "" + find("#link_area", "재생 URL").getText();
    if (playUrl.indexOf("key=") >= 0) {                                             // 보안키 적용된 재생 URL 확보
      browser.navigate(playUrl);
      var playBtn = browser.findElement("css selector", ".jw-icon-display");        // JW 플레이어
      if (playBtn !== null) {
        try { playBtn.click(); } catch (e) {}                                        // 재생
        steps.securitykey = 1;                                                        // 보안키 생성 + 재생 확인
      }
      browser.collectPerfEntries("securitykey-play");
    }
    // 주의: 위 두 검증(key= 부재/플레이어 null)은 예외 없이 0이 되는 경로 -> errors.securitykey 없이 실패할 수 있음
    lap("securitykey");   // Step 4 전체(키 생성+URL 적용+재생 검증)
  });

} catch (err) {
  // 치명 경로(파라미터 파싱/로그인/인프라)만 여기로 온다. 블록 에러는 runBlock이 errors에 기록.
  steps.err = "" + (err && err.message ? err.message : err);
  steps.err_at = crumb;
  steps.err_class = classify(steps.err);
  if (!(err instanceof BrowserError)) { browser.setError(err.message); }
} finally {
  var order = ["login", "category", "deploy", "media", "securitykey", "subuser"];
  // 최초 블록 에러를 steps.err*로 승격 (치명 catch가 이미 채웠으면 유지) — 기존 dependent(error.at/class) 호환
  if (steps.err === undefined) {
    for (var ei = 0; ei < order.length; ei++) {
      var eb = order[ei] === "deploy" ? "category" : order[ei];
      if (errors[eb]) {
        steps.err = errors[eb].msg; steps.err_at = errors[eb].at; steps.err_class = errors[eb].class;
        break;
      }
    }
  }
  var failed = 0;
  for (var k = 0; k < order.length; k++) {
    if (steps[order[k]] === 2) { continue; }             // 스킵은 실패가 아님
    if (steps[order[k]] !== 1) { failed = k + 1; break; }
  }
  result = browser.getResult();
  result.steps = steps;
  result.failed_step = failed;
  result.step_seconds = stepSec;   // 스텝 블록별 벽시계(초)
  result.healed_count = healedCount;   // 항상 존재(0 포함) — last()>0 트리거가 unsupported 없이 동작하게
  var hk, hasHealed = false, hasErrors = false;
  for (hk in healed) { hasHealed = true; break; }
  if (hasHealed) { result.healed = healed; }
  for (hk in errors) { hasErrors = true; break; }
  if (hasErrors) { result.errors = errors; }
  if (only !== null) { result.only = "" + params.only; }   // 온디맨드 실행임을 payload에 자기서술
  return JSON.stringify(result);
}
