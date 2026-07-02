/*
 * midibus Browser Item — E2E 시나리오 (Zabbix 7.0 Browser item Script)
 * -----------------------------------------------------------------------------
 * Host      : midibus
 * Item key  : browser.midibus.e2e   (Type: Browser, Timeout 300s)
 * Parameters: username={$MIDIBUS.USER}, password={$MIDIBUS.PASS},
 *             url=https://midibus.kinxcdn.com/login   (계정은 Secret 매크로)
 * 반환 JSON : {"steps":{login,category,deploy,media,securitykey,subuser}, "failed_step":N}
 *
 * 선행조건: selenium 컨테이너에 /testdata/beach.mp4 (compose 볼륨 마운트).
 *          -> VM에서 git pull && docker compose up -d
 *
 * 핵심 해결책:
 *  - 네이티브 confirm 자동 수락: opts.capabilities.alwaysMatch.unhandledPromptBehavior="accept"
 *  - 로그인 후 팝업 3종 -> /config 풀 네비게이트로 우회
 *  - 카테고리 생성 버튼(#addCategoryBtn)은 미디어 서브메뉴(#menu_media_icon) 열어야 노출
 *  - 생성 직후 오버레이 -> /config 풀 네비게이트로 제거
 *  - wait API 없음 -> findElement 폴링(clickReady/typeReady/waitForXpath/waitGone)
 *
 * [주의] 미디어 스텝은 매 실행 업로드+서버 인코딩 -> 무거움. 긴 주기(예: 1h)/수동 실행 권장.
 */
var params = JSON.parse(value);
var opts = Browser.chromeOptions();
opts.capabilities.alwaysMatch.unhandledPromptBehavior = "accept";   // 네이티브 다이얼로그 자동 수락
var browser = new Browser(opts);
var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };

function waitFor(sel, tries){ tries=tries||50; for(var i=0;i<tries;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ return e; } } return null; }
function waitForXpath(xp, tries){ tries=tries||50; for(var i=0;i<tries;i++){ var e=browser.findElement("xpath",xp); if(e!==null){ return e; } } return null; }
function waitGone(sel, tries){ tries=tries||30; for(var i=0;i<tries;i++){ if(browser.findElement("css selector",sel)===null){ return true; } } return false; }
function clickReady(sel){ for(var i=0;i<30;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ try{ e.click(); return true; }catch(err){} } } return false; }
function typeReady(sel,txt){ for(var i=0;i<30;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ try{ e.sendKeys(txt); return true; }catch(err){} } } return false; }

try {
  // Step 1: 로그인
  browser.navigate(params.url);
  typeReady("#username", params.username);
  typeReady("#password", params.password);
  clickReady("#midibusLoginBtn");
  if (waitFor("#accountDropdownBtn") !== null) { steps.login = 1; }

  browser.navigate("https://midibus.kinxcdn.com/config");
  clickReady("#categoryTab-tab");

  // Step 2: 카테고리 생성 -> 자동배포 -> 삭제
  if (waitFor("#allCategories a[title=\"zbx-e2e-test\"]", 10) === null) {
    clickReady("#menu_media_icon"); clickReady("#addCategoryBtn");
    typeReady("#newCategoryName", "zbx-e2e-test");
    clickReady("button[onclick=\"createNewCategory()\"]");
    browser.navigate("https://midibus.kinxcdn.com/config"); clickReady("#categoryTab-tab");
  }
  var catLink = waitFor("#allCategories a[title=\"zbx-e2e-test\"]");
  if (catLink !== null) {
    steps.category = 1; catLink.click();
    var chk = waitFor("#autoDistribution");
    if (chk !== null) { if (chk.getAttribute("checked") !== "true") { clickReady("#autoDistribution"); } clickReady("#categoryConfigSaveBtn"); steps.deploy = 1; }
    clickReady("#deleteCategoryBtn");
  }

  // Step 3: 미디어 업로드 -> 확인 -> 삭제 -> 확인
  clickReady("#menu_media_icon");
  clickReady("#fileUploadBtn_small");
  typeReady(".qq-upload-button input[type=\"file\"]", "/testdata/beach.mp4");   // 숨은 파일 input
  clickReady("#trigger-upload");                                                // 업로드 시작
  var nameDiv = waitForXpath("//div[contains(@id,'mediaName_') and contains(text(),'beach.mp4')]", 120);
  if (nameDiv !== null) {
    steps.media = 1;                                                            // 업로드 확인
    var nid = nameDiv.getAttribute("id");                                       // mediaName_<key>_<cat>
    if (nid) {
      var chkId = nid.replace("mediaName_", "mediaCheck_");
      clickReady("#" + chkId);                                                   // 미디어 선택
      clickReady("#mediaActionSelector option[value=\"delete\"]");              // 작업선택->삭제(confirm 자동수락)
      steps.dbg_media_deleted = waitGone("#" + chkId, 30);                       // 삭제 확인
    }
  }

  // TODO Step 4~5: 보안키, 보조사용자

} catch (err) {
  steps.error = "" + err;
  try { steps.screenshot = browser.getScreenshot(); } catch (e2) {}
}

var order = ["login","category","deploy","media","securitykey","subuser"];
var failed = 0;
for (var k=0;k<order.length;k++){ if (steps[order[k]] !== 1) { failed = k+1; break; } }
browser.collectPerfEntries();
var result = browser.getResult();
result.steps = steps;
result.failed_step = failed;
return JSON.stringify(result);
