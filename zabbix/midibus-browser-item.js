/*
 * midibus Browser Item — E2E 시나리오 (Zabbix 7.0 Browser item Script)
 * -----------------------------------------------------------------------------
 * Host      : midibus
 * Item key  : browser.midibus.e2e   (Type: Browser, Timeout 300s)
 * Parameters: username={$MIDIBUS.USER}, password={$MIDIBUS.PASS},
 *             url=https://midibus.kinxcdn.com/login
 *             (계정은 Secret 매크로 → 스크립트에 하드코딩 없음)
 * 반환 JSON : {"steps":{login,category,deploy,media,securitykey,subuser}, "failed_step":N}
 *
 * 구현 노트 (reverse-engineering 결과):
 *  - 로그인 후 튜토리얼/트라이얼/whatsNew 팝업 3종이 클릭을 가로챔(localStorage 날짜 gated,
 *    자동화는 매 세션 새로 떠서 항상 발생) → /config 로 "풀 네비게이트"하여 우회.
 *  - 카테고리 생성 버튼(#addCategoryBtn)은 미디어 서브메뉴(#menu_media_icon)를 열어야 노출됨.
 *  - 생성 직후 생성레이어 오버레이가 클릭을 가로챔 → 다시 /config 풀 네비게이트로 오버레이 제거.
 *  - 카테고리 삭제는 네이티브 confirm() → Zabbix Browser엔 alert 처리 API 없음,
 *    unhandledPromptBehavior도 미적용 → Step2는 삭제 없이 persistent(create-if-not-exists)로 멱등 확보.
 *  - wait API 없음 → findElement 폴링(clickReady/typeReady)로 대기 대용.
 */
var params = JSON.parse(value);
var browser = new Browser(Browser.chromeOptions());
var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };

function waitFor(sel, tries){ tries=tries||50; for(var i=0;i<tries;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ return e; } } return null; }
function clickReady(sel){ for(var i=0;i<30;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ try{ e.click(); return true; }catch(err){} } } return false; }
function typeReady(sel,txt){ for(var i=0;i<30;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ try{ e.sendKeys(txt); return true; }catch(err){} } } return false; }

try {
  // Step 1: 로그인
  browser.navigate(params.url);
  typeReady("#username", params.username);
  typeReady("#password", params.password);
  clickReady("#midibusLoginBtn");
  if (waitFor("#accountDropdownBtn") !== null) { steps.login = 1; }

  // 팝업 우회 + 설정 카테고리 탭
  browser.navigate("https://midibus.kinxcdn.com/config");
  clickReady("#categoryTab-tab");

  // Step 2: 카테고리 (create-if-not-exists → 멱등, 삭제 없음)
  var existing = waitFor("#allCategories a[title=\"zbx-e2e-test\"]", 20);
  if (existing === null) {
    clickReady("#menu_media_icon");                          // 미디어 서브메뉴 열기
    clickReady("#addCategoryBtn");                           // 생성 레이어
    typeReady("#newCategoryName", "zbx-e2e-test");
    clickReady("button[onclick=\"createNewCategory()\"]");
    browser.navigate("https://midibus.kinxcdn.com/config");  // 오버레이 회피(풀 재로드)
    clickReady("#categoryTab-tab");
  }

  var catLink = waitFor("#allCategories a[title=\"zbx-e2e-test\"]");
  if (catLink !== null) {
    steps.category = 1;
    catLink.click();
    var chk = waitFor("#autoDistribution");                  // Step 2a: 채널 자동배포 설정
    if (chk !== null) {
      if (chk.getAttribute("checked") !== "true") { clickReady("#autoDistribution"); }
      clickReady("#categoryConfigSaveBtn");
      steps.deploy = 1;
    }
  } else {
    try { steps.screenshot = browser.getScreenshot(); } catch (e2) {}
  }

  // TODO Step 3~5: 미디어 업로드/삭제, 보안키, 보조사용자 (미디어 삭제 confirm 대응 필요)

} catch (err) {
  steps.error = "" + err;
  try { steps.screenshot = browser.getScreenshot(); } catch (e3) {}
}

var order = ["login","category","deploy","media","securitykey","subuser"];
var failed = 0;
for (var k=0;k<order.length;k++){ if (steps[order[k]] !== 1) { failed = k+1; break; } }
browser.collectPerfEntries();
var result = browser.getResult();
result.steps = steps;
result.failed_step = failed;
return JSON.stringify(result);
