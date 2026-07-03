/*
 * midibus Browser Item - E2E scenario (Zabbix 7.0 Browser item)
 * -----------------------------------------------------------------------------
 * Host: midibus / key: browser.midibus.e2e / Type: Browser / Timeout 300s
 * Params: username={$MIDIBUS.USER} password={$MIDIBUS.PASS} url=https://midibus.kinxcdn.com/login
 * 선행: selenium 컨테이너 /testdata/beach.mp4 (compose 마운트)
 * 배포: zabbix/update-item-script.sh (API push, 웹 에디터 우회)
 *
 * 정석 API 사용 (레퍼런스: manual/config/items/preprocessing/javascript/browser_item_javascript_objects):
 *  - setElementWaitTimeout : findElement 암묵적 대기 (수동 폴링 루프 제거)
 *  - unhandledPromptBehavior=accept : 네이티브 confirm 자동 수락 (표준 W3C capability)
 *  - collectPerfEntries(mark): 스텝별 성능 마크
 *  - setError / BrowserError: 구조화된 에러
 *  - getProperty            : 체크박스 실시간 상태
 */
var opts = Browser.chromeOptions();
opts.capabilities.alwaysMatch.unhandledPromptBehavior = "accept";   // 표준 W3C capability: confirm/alert 자동 수락(navigate 많은 흐름에 안전)
var browser = new Browser(opts);
browser.setScreenSize(1920, 1080);
browser.setSessionTimeout(30000);       // 페이지 로드 타임아웃
browser.setElementWaitTimeout(10000);   // findElement 암묵적 대기

var steps = { login:0, category:0, deploy:0, media:0, securitykey:0, subuser:0 };
steps.v = "api-v2";
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
try {
  var params = JSON.parse(value);

  // Step 1: 로그인
  browser.navigate(params.url);
  find("#username", "username").sendKeys(params.username);
  find("#password", "password").sendKeys(params.password);
  find("#midibusLoginBtn", "login button").click();
  find("#accountDropdownBtn", "login success marker");
  steps.login = 1;
  browser.collectPerfEntries("login");

  // Step 2: 카테고리 생성 -> 자동배포 -> 삭제
  browser.navigate("https://midibus.kinxcdn.com/config");
  find("#categoryTab-tab", "category tab").click();

  if (gone('#allCategories a[title="zbx-e2e-test"]', 3000)) {   // 없으면 생성
    find("#menu_media_icon", "media menu").click();
    find("#addCategoryBtn", "add category button").click();
    var nameInput = find("#newCategoryName", "category name input");
    nameInput.clear();
    nameInput.sendKeys("zbx-e2e-test");
    find('button[onclick="createNewCategory()"]', "create category button").click();
    browser.navigate("https://midibus.kinxcdn.com/config");
    find("#categoryTab-tab", "category tab (after create)").click();
  }

  find('#allCategories a[title="zbx-e2e-test"]', "category link").click();
  steps.category = 1;
  browser.collectPerfEntries("category-create");

  var chk = find("#autoDistribution", "auto distribution checkbox");
  var checked = chk.getProperty("checked");
  if (checked !== true && checked !== "true") { chk.click(); }
  find("#categoryConfigSaveBtn", "category save button").click();
  steps.deploy = 1;
  browser.collectPerfEntries("category-deploy");

  find("#deleteCategoryBtn", "delete category button").click();   // confirm 자동 수락(accept)
  browser.collectPerfEntries("category-delete");

  // Step 3: 미디어 업로드 -> 확인 -> 삭제
  find(".fileUploadBtn", "media upload button").click();
  find('.qq-upload-button input[type="file"]', "file input").sendKeys("/testdata/beach.mp4");
  find("#trigger-upload", "upload start button").click();

  browser.setElementWaitTimeout(60000);                        // 업로드+서버처리 대기(길게)
  find(".qq-upload-list li.qq-upload-success", "upload success");
  browser.setElementWaitTimeout(10000);
  browser.collectPerfEntries("media-upload");

  browser.navigate("https://midibus.kinxcdn.com/media");       // 미디어 목록
  var nameDiv = findX("//div[contains(@id,'mediaName_') and contains(text(),'beach.mp4')]", "uploaded media in list");
  steps.media = 1;

  var chkId = nameDiv.getAttribute("id").replace("mediaName_", "mediaCheck_");
  find("#" + chkId, "media checkbox").click();
  find("#mediaActionSelector", "media action selector").sendKeys("삭제");   // change -> confirm 자동 수락
  browser.collectPerfEntries("media-delete");

} catch (err) {
  steps.err = "" + (err && err.message ? err.message : err);   // 에러 메시지 노출(진단)
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
