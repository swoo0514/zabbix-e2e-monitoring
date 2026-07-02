/*
 * midibus Browser Item - E2E scenario (Zabbix 7.0 Browser item Script)
 * Host: midibus / key: browser.midibus.e2e / Type: Browser / Timeout 300s
 * Params: username={$MIDIBUS.USER} password={$MIDIBUS.PASS} url=https://midibus.kinxcdn.com/login
 * 선행: selenium 컨테이너에 /testdata/beach.mp4 (compose 마운트)
 * 배포: 웹 에디터 붙여넣기가 깨지므로 zabbix/update-item-script.sh (API push) 사용 권장.
 */
var params = JSON.parse(value);
var opts = Browser.chromeOptions();
opts.capabilities.alwaysMatch.unhandledPromptBehavior = "accept";
var browser = new Browser(opts);
browser.setScreenSize(1920, 1080);   // 반응형 접힘/뷰포트 밖 방지: 데스크톱 해상도 강제
var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };
steps.v = "s3dbg7";

function waitFor(sel, tries){ tries=tries||50; for(var i=0;i<tries;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ return e; } } return null; }
function waitForXpath(xp, tries){ tries=tries||50; for(var i=0;i<tries;i++){ var e=browser.findElement("xpath",xp); if(e!==null){ return e; } } return null; }
function waitGone(sel, tries){ tries=tries||30; for(var i=0;i<tries;i++){ if(browser.findElement("css selector",sel)===null){ return true; } } return false; }
function clickReady(sel){ for(var i=0;i<30;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ try{ e.click(); return true; }catch(err){} } } return false; }
function typeReady(sel,txt){ for(var i=0;i<30;i++){ var e=browser.findElement("css selector",sel); if(e!==null){ try{ e.sendKeys(txt); return true; }catch(err){} } } return false; }

try {
  browser.navigate(params.url);
  typeReady("#username", params.username);
  typeReady("#password", params.password);
  clickReady("#midibusLoginBtn");
  if (waitFor("#accountDropdownBtn") !== null) { steps.login = 1; }

  browser.navigate("https://midibus.kinxcdn.com/config");
  clickReady("#categoryTab-tab");

  if (waitFor('#allCategories a[title="zbx-e2e-test"]', 10) === null) {
    clickReady("#menu_media_icon");
    clickReady("#addCategoryBtn");
    typeReady("#newCategoryName", "zbx-e2e-test");
    clickReady('button[onclick="createNewCategory()"]');
    browser.navigate("https://midibus.kinxcdn.com/config");
    clickReady("#categoryTab-tab");
  }
  var catLink = waitFor('#allCategories a[title="zbx-e2e-test"]');
  if (catLink !== null) {
    steps.category = 1;
    catLink.click();
    var chk = waitFor("#autoDistribution");
    if (chk !== null) {
      if (chk.getAttribute("checked") !== "true") { clickReady("#autoDistribution"); }
      clickReady("#categoryConfigSaveBtn");
      steps.deploy = 1;
    }
    clickReady("#deleteCategoryBtn");
  }

  // Step 3: 미디어 업로드 + 업로더 자체 "완료" 신호로 확인 (목록/삭제는 목록화면 진입법 확인 후)
  steps.dbg_m_enter = clickReady(".fileUploadBtn");                              // 업로드 패널 열기
  waitFor("#trigger-upload", 30);
  steps.dbg_m_file = typeReady('.qq-upload-button input[type="file"]', "/testdata/beach.mp4");
  steps.dbg_qq_listed = (waitFor(".qq-upload-list li", 15) !== null);
  steps.dbg_m_trigger = clickReady("#trigger-upload");                          // 업로드 시작
  var okLi = waitFor(".qq-upload-list li.qq-upload-success", 200);              // 업로드 성공 대기(전송+처리 시간)
  steps.dbg_upload_success = (okLi !== null);
  var anyLi = waitFor(".qq-upload-list li", 5);
  if (anyLi !== null) { steps.dbg_qq_liclass = anyLi.getAttribute("class"); }   // 성공/실패/진행 상태 클래스 관찰
  if (steps.dbg_upload_success) { steps.media = 1; }
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
