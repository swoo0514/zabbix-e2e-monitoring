/*
 * midibus Browser Item - E2E scenario (Zabbix 7.0 Browser item)
 * -----------------------------------------------------------------------------
 * Host: midibus / key: browser.midibus.e2e / Type: Browser / Timeout 300s
 * Params: username={$MIDIBUS.USER} password={$MIDIBUS.PASS} url=https://midibus.kinxcdn.com/login
 * 선행: selenium 컨테이너 /testdata/beach.mp4 (compose 마운트)
 * 배포: zabbix/update-item-script.sh (API push, 웹 에디터 우회)
 *
 * 정석 API (레퍼런스: manual/config/items/preprocessing/javascript/browser_item_javascript_objects):
 *  - setElementWaitTimeout : findElement 암묵적 대기(요소 '존재' 대기 -> 수동 폴링 제거)
 *  - unhandledPromptBehavior=accept : 네이티브 confirm 자동 수락(표준 W3C capability)
 *  - collectPerfEntries(mark): 스텝별 성능 마크
 *  - setError / BrowserError: 구조화된 에러
 *  - getProperty            : 체크박스 실시간 상태
 * 주의: implicit wait는 '가림(click intercepted)'은 못 푼다 -> click()에서 가림일 때만 재시도.
 */
var opts = Browser.chromeOptions();
opts.capabilities.alwaysMatch.unhandledPromptBehavior = "accept";
var browser = new Browser(opts);
browser.setScreenSize(1920, 1080);
browser.setSessionTimeout(30000);
browser.setElementWaitTimeout(10000);

var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };
steps.v = "api-v3";
var result;

function find(sel, name) {
  var el = browser.findElement("css selector", sel);
  if (el === null) { throw Error("not found: " + name + " (" + sel + ")"); }
  return el;
}
function findX(xp, name) {
  var el = browser.findElement("xpath", xp);
  if (el === null) { throw Error("not found: " + name); }
  return el;
}
function gone(sel, waitMs) {             // 짧은 대기로 '부재' 확인
  browser.setElementWaitTimeout(waitMs || 2000);
  var el = browser.findElement("css selector", sel);
  browser.setElementWaitTimeout(10000);
  return el === null;
}
function click(sel, name) {              // 존재는 implicit wait, '가림'일 때만 재시도
  var el = find(sel, name);
  for (var i = 0; i < 15; i++) {
    try { el.click(); return; }
    catch (e) {
      if (("" + e).indexOf("intercepted") < 0) { throw e; }   // 가림 외 에러는 즉시 던짐
      Zabbix.sleep(300);
      var re = browser.findElement("css selector", sel);
      if (re !== null) { el = re; }
    }
  }
  el.click();   // 마지막 시도(예외 그대로 전파)
}

try {
  var params = JSON.parse(value);

  // Step 1: 로그인
  browser.navigate(params.url);
  find("#username", "username").sendKeys(params.username);
  find("#password", "password").sendKeys(params.password);
  click("#midibusLoginBtn", "login button");
  find("#accountDropdownBtn", "login success marker");
  steps.login = 1;
  browser.collectPerfEntries("login");

  // Step 2: 카테고리 생성 -> 자동배포 -> 삭제
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

  // Step 3: 미디어 업로드 -> 확인 -> 삭제
  click(".fileUploadBtn", "media upload button");
  find('.qq-upload-button input[type="file"]', "file input").sendKeys("/testdata/beach.mp4");
  click("#trigger-upload", "upload start button");

  browser.setElementWaitTimeout(60000);
  find(".qq-upload-list li.qq-upload-success", "upload success");
  browser.setElementWaitTimeout(10000);
  browser.collectPerfEntries("media-upload");

  browser.navigate("https://midibus.kinxcdn.com/media");
  var nameDiv = findX("//div[contains(@id,'mediaName_') and contains(text(),'beach.mp4')]", "uploaded media in list");
  steps.media = 1;

  var chkId = nameDiv.getAttribute("id").replace("mediaName_", "mediaCheck_");
  click("#" + chkId, "media checkbox");
  find("#mediaActionSelector", "media action selector").sendKeys("삭제");   // change -> confirm 자동 수락
  browser.collectPerfEntries("media-delete");

} catch (err) {
  steps.err = "" + (err && err.message ? err.message : err);
  if (!(err instanceof BrowserError)) { browser.setError(err.message); }
} finally {
  var order = ["login", "category", "deploy", "media", "securitykey", "subuser"];
  var failed = 0;
  for (var k = 0; k < order.length; k++) { if (steps[order[k]] !== 1) { failed = k + 1; break; } }
  result = browser.getResult();
  result.steps = steps;
  result.failed_step = failed;
  return JSON.stringify(result);
}
