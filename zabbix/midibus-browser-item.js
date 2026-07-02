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
var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };
steps.v = "s3dbg4";

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

  // Step 3: 업로드 진입 클릭 에러/qq 등록 여부를 정확히 캡처
  steps.dbg_enter_found = (waitFor("#fileUploadBtn_small", 20) !== null);
  try { browser.findElement("css selector", "#fileUploadBtn_small").click(); steps.dbg_m_enter = true; }
  catch (e3) { steps.dbg_enter_err = "" + e3; }
  waitFor("#trigger-upload", 20);
  steps.dbg_m_file = typeReady('.qq-upload-button input[type="file"]', "/testdata/beach.mp4");
  steps.dbg_qq_listed = (waitFor(".qq-upload-list li", 15) !== null);   // qq가 파일을 큐에 등록했나
  try { browser.findElement("css selector", "#trigger-upload").click(); steps.dbg_m_trigger = true; }
  catch (e4) { steps.dbg_trig_err = "" + e4; }
  var nameDiv = waitForXpath("//div[contains(@id,'mediaName_') and contains(text(),'beach.mp4')]", 120);
  steps.dbg_m_found = (nameDiv !== null);
  if (nameDiv !== null) {
    steps.media = 1;
    var nid = nameDiv.getAttribute("id");
    if (nid) {
      var chkId = nid.replace("mediaName_", "mediaCheck_");
      clickReady("#" + chkId);
      clickReady('#mediaActionSelector option[value="delete"]');
      steps.dbg_media_deleted = waitGone("#" + chkId, 30);
    }
  }
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
