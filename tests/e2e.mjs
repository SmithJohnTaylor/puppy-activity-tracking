import { chromium } from "playwright";
import { createServer } from "http";
import { readFileSync, mkdirSync } from "fs";

// End-to-end tests: serves ../index.html locally, fakes the GitHub contents API,
// and drives the app in headless Chromium. Screenshots land in tests/screenshots/.
const APP = new URL("../index.html", import.meta.url).pathname;
const OUT = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(readFileSync(APP)); });
await new Promise(r => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;

let pass = 0, fail = 0;
const poll = async (fn, ms = 2000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { if ((v = await fn())) return v; await new Promise(r => setTimeout(r, 50)); } return v; };
const check = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

// ---- fake GitHub contents API ----
const gh = { sha: null, json: null, n: 0, puts: 0, conflicts: 0, forceConflict: false, auths: new Set() };
const putRemote = obj => { gh.json = obj; gh.sha = `sha${++gh.n}`; };
async function mockGitHub(ctx) {
  await ctx.route("https://api.github.com/**", async route => {
    const req = route.request();
    gh.auths.add(req.headers()["authorization"]);
    if (req.method() === "GET") {
      if (!gh.sha) return route.fulfill({ status: 404, json: { message: "Not Found" } });
      return route.fulfill({ json: { sha: gh.sha, content: Buffer.from(JSON.stringify(gh.json)).toString("base64") } });
    }
    const body = JSON.parse(req.postData());
    if (gh.forceConflict) { // someone else wrote in between
      gh.forceConflict = false;
      putRemote({ ...gh.json, events: [...gh.json.events, { id: "other-device", type: "walk", ts: Date.now() - 1000, note: "", updated: 1 }] });
    }
    if ((body.sha || null) !== gh.sha) { gh.conflicts++; return route.fulfill({ status: 409, json: { message: "conflict" } }); }
    gh.puts++;
    check("PUT targets data branch", body.branch === "data");
    putRemote(JSON.parse(Buffer.from(body.content, "base64").toString("utf8")));
    return route.fulfill({ json: { content: { sha: gh.sha } } });
  });
}

const browser = await chromium.launch();
const errors = [];
async function device(name, cfg) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  if (cfg) await ctx.addInitScript(c => { if (!localStorage.getItem("puppylog.cfg")) localStorage.setItem("puppylog.cfg", JSON.stringify(c)); }, cfg);
  await mockGitHub(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  
  await page.goto(URL_);
  return page;
}
const synced = p => p.waitForFunction(() => document.getElementById("sync").textContent.includes("synced"), null, { timeout: 5000 });
const settle = p => p.waitForTimeout(1200).then(() => synced(p));

// ================= local-only mode =================
{
  const p = await device("local");
  check("renders 9 activity cards", await p.locator(".act").count() === 9);
  check("empty timeline message", await p.locator(".empty").isVisible());
  check("status says local only", (await p.textContent("#sync")) === "local only");
  const noHScroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check("no horizontal scroll at 375px", noHScroll);
  await p.screenshot({ path: OUT + "1-empty.png", fullPage: true });

  await p.tap('.act[data-type="pee"]');
  check("toast shows after tap", await p.locator("#toast").isVisible());
  check("card shows 'just now'", (await p.textContent('.act[data-type="pee"] .ago')).startsWith("just now"));
  check("card colored fresh", await p.locator('.act[data-type="pee"].fresh').count() === 1);
  check("timeline has 1 entry under Today", await p.locator(".tl li").count() === 1 && (await p.textContent(".day")) === "Today");

  // undo
  await p.tap("#toastUndo");
  check("undo removes entry", await p.locator(".tl li").count() === 0);
  check("card back to 'never'", (await p.textContent('.act[data-type="pee"] .ago')) === "never");

  // log several, edit one to yesterday with unicode note
  for (const t of ["pee", "poop", "eat", "pee"]) await p.tap(`.act[data-type="${t}"]`);
  check("4 entries logged", await p.locator(".tl li").count() === 4);
  await p.locator(".tl li").last().tap();
  check("edit dialog opens", await p.locator("#editDlg").isVisible());
  const y = new Date(Date.now() - 864e5 - 3 * 36e5); y.setMinutes(y.getMinutes() - y.getTimezoneOffset());
  await p.fill("#eTime", y.toISOString().slice(0, 16));
  await p.fill("#eNote", `outside <b>ok</b> 🌳 ✓`);
  await p.click('#editDlg button[value="save"]');
  const days = await poll(async () => { const d = (await p.locator(".day").allTextContents()).join(","); return d === "Today,Yesterday" && d; });
  check("edit moved entry to Yesterday", days, (await p.locator(".day").allTextContents()).join(","));
  check("note HTML-escaped", (await p.locator(".tl .n").textContent()).includes("<b>ok</b>"));

  // stale color: yesterday's pee should NOT drive card (latest pee is today) but eat edit → stale
  await p.locator(".tl li", { hasText: "Eat" }).tap();
  const old = new Date(Date.now() - 10 * 36e5); old.setMinutes(old.getMinutes() - old.getTimezoneOffset());
  await p.fill("#eTime", old.toISOString().slice(0, 16));
  await p.click('#editDlg button[value="save"]');
  check("eat 10h ago shows stale (red)", await poll(async () => await p.locator('.act[data-type="eat"].stale').count() === 1));

  // filter + gap
  await p.tap('.chip[data-filter="pee"]');
  check("filter shows only pee", await p.locator(".tl li").count() === 2);
  check("filter shows gap between pees", await p.locator(".tl .gap").count() === 1, await p.locator(".tl .gap").first().textContent());
  await p.screenshot({ path: OUT + "2-filtered.png", fullPage: true });
  await p.tap('.chip[data-filter="all"]');

  // delete
  await p.locator(".tl li", { hasText: "Poop" }).tap();
  await p.click("#eDelete");
  check("delete removes entry", await p.locator(".tl li", { hasText: "Poop" }).count() === 0);

  // cancel edit does nothing
  const before = await p.locator("#timeline").innerHTML();
  await p.locator(".tl li").first().tap();
  await p.fill("#eNote", "should not save");
  await p.click('#editDlg button[value="cancel"]');
  await p.waitForTimeout(200);
  check("cancel leaves entry unchanged", (await p.locator("#timeline").innerHTML()) === before);

  // persistence
  await p.reload();
  check("data persists across reload", await p.locator(".tl li").count() === 3);

  // settings: name
  await p.tap("#settingsBtn");
  await p.fill("#sName", "Biscuit");
  await p.click('#setDlg button[value="save"]');
  check("puppy name in header", await poll(async () => (await p.textContent("#title")).includes("Biscuit")));
  await p.screenshot({ path: OUT + "3-local.png", fullPage: true });

  // dark mode
  await p.emulateMedia({ colorScheme: "dark" });
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("dark mode background", bg === "rgb(27, 24, 22)", bg);
  await p.screenshot({ path: OUT + "4-dark.png", fullPage: true });

  // ---- log earlier ----
  await p.emulateMedia({ colorScheme: "light" });
  const n0 = await p.locator(".tl li").count();
  await p.tap("#addPast");
  check("＋ Log earlier opens dialog", await p.locator("#editDlg").isVisible() && (await p.textContent("#eTitle")) === "Log earlier");
  check("new-entry dialog hides Delete", !(await p.locator("#eDelete").isVisible()));
  await p.click('#editDlg button[value="cancel"]');
  await p.waitForTimeout(200);
  check("cancel creates nothing", await p.locator(".tl li").count() === n0);

  await p.tap("#addPast");
  await p.selectOption("#eType", "walk");
  await p.click('#eQuick [data-min="60"]');
  await p.fill("#eNote", "forgot");
  await p.screenshot({ path: OUT + "6-log-earlier.png" });
  await p.click('#editDlg button[value="save"]');
  check("quick '1h ago' logs walk 1h ago", await poll(async () => (await p.textContent('.act[data-type="walk"] .ago')).startsWith("1h 0m ago")),
    await p.textContent('.act[data-type="walk"] .ago'));
  check("past entry has note + toast", (await p.locator(".tl li", { hasText: "Walk" }).textContent()).includes("forgot") && await p.locator("#toast").isVisible());

  // future time rejected by form validation
  await p.tap("#addPast");
  const fut = new Date(Date.now() + 3 * 36e5); fut.setMinutes(fut.getMinutes() - fut.getTimezoneOffset());
  await p.fill("#eTime", fut.toISOString().slice(0, 16));
  await p.click('#editDlg button[value="save"]');
  await p.waitForTimeout(200);
  check("future time blocked (dialog stays open)", await p.locator("#editDlg").isVisible());
  await p.click('#editDlg button[value="cancel"]');
  await p.waitForTimeout(200);

  // long-press poop card
  const n1 = await p.locator(".tl li").count();
  await p.locator('.act[data-type="poop"]').scrollIntoViewIfNeeded();
  const box = await p.locator('.act[data-type="poop"]').boundingBox();
  await p.mouse.move(box.x + 40, box.y + 40); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
  await p.waitForTimeout(200);
  check("long-press opens Log earlier with Poop preselected", await p.locator("#editDlg").isVisible() && (await p.inputValue("#eType")) === "poop");
  check("long-press did not also log a tap", await p.locator(".tl li").count() === n1);
  await p.click('#eQuick [data-min="30"]');
  await p.click('#editDlg button[value="save"]');
  check("long-press entry saved 30m ago", await poll(async () => (await p.textContent('.act[data-type="poop"] .ago')).startsWith("30m ago")));

  // short tap still logs instantly
  await p.tap('.act[data-type="drink"]');
  check("normal tap still logs now", (await p.textContent('.act[data-type="drink"] .ago')).startsWith("just now") && !(await p.locator("#editDlg").isVisible()));

  // quick buttons inside regular edit
  await p.locator(".tl li", { hasText: "Drink" }).tap();
  check("edit dialog title + Delete visible", (await p.textContent("#eTitle")) === "Edit entry" && await p.locator("#eDelete").isVisible());
  await p.click('#eQuick [data-min="120"]');
  await p.click('#editDlg button[value="save"]');
  check("quick time works in edit", await poll(async () => (await p.textContent('.act[data-type="drink"] .ago')).startsWith("2h 0m ago")));

  // ---- accidents ----
  const cnt = () => p.locator(".tl li").count();
  const a0 = await cnt();
  await p.tap('.act[data-type="accident"]');
  check("accident tap opens chooser", await p.locator("#accDlg").isVisible());
  check("accident tap logs nothing yet", await cnt() === a0);
  await p.screenshot({ path: OUT + "8-accident-chooser.png" });
  await p.click('#accDlg button[value="cancel"]');
  await p.waitForTimeout(200);
  check("chooser cancel logs nothing", await cnt() === a0 && !(await p.locator("#accDlg").isVisible()));

  // make pee card old first, so we can see accident refresh it
  await p.locator(".tl li", { hasText: "Pee" }).first().tap();
  await p.click('#eQuick [data-min="120"]');
  await p.click('#editDlg button[value="save"]');
  await poll(async () => (await p.textContent('.act[data-type="pee"] .ago')).startsWith("2h"));

  await p.tap('.act[data-type="accident"]');
  await p.click('#accDlg button[value="pee"]');
  check("pee accident: one entry added", await poll(async () => await cnt() === a0 + 1));
  check("pee accident: Pee card updated to just now", (await p.textContent('.act[data-type="pee"] .ago')).startsWith("just now"));
  check("pee accident: Accident card updated", (await p.textContent('.act[data-type="accident"] .ago')).startsWith("just now"));
  check("pee accident: timeline shows Pee + 🚨 accident badge", (await p.locator(".tl li").first().textContent()).includes("Pee") && await p.locator(".tl li").first().locator(".acc").count() === 1);
  check("pee accident: toast says accident", (await p.textContent("#toastMsg")).includes("Pee accident"));

  await p.tap('.act[data-type="accident"]');
  await p.click('#accDlg button[value="both"]');
  check("both: two entries added", await poll(async () => await cnt() === a0 + 3));
  check("both: toast has no Edit, has Undo", !(await p.locator("#toastEdit").isVisible()) && await p.locator("#toastUndo").isVisible());
  await p.tap("#toastUndo");
  check("both: undo removes both", await poll(async () => await cnt() === a0 + 1));

  await p.tap('.act[data-type="accident"]');
  await p.click('#accDlg button[value="poop"]');
  await poll(async () => await cnt() === a0 + 2);
  check("poop accident: Poop card just now", (await p.textContent('.act[data-type="poop"] .ago')).startsWith("just now"));

  // filters
  await p.tap('.chip[data-filter="accident"]');
  check("Accident filter shows only accidents (2)", await cnt() === 2 && await p.locator(".tl .acc").count() === 2);
  await p.tap('.chip[data-filter="pee"]');
  const peeRows = await p.locator(".tl li").allTextContents();
  check("Pee filter includes accident pees", peeRows.some(r => r.includes("accident")) && peeRows.some(r => !r.includes("accident")));
  await p.tap('.chip[data-filter="all"]');

  // edit: checkbox shown for pee/poop only, unflag works
  await p.locator(".tl li", { hasText: "Poop" }).first().tap();
  check("edit shows accident checkbox checked", await p.locator("#eAcc").isVisible() && await p.isChecked("#eAcc"));
  check("Accident not an option in type select", await p.locator('#eType option[value="accident"]').count() === 0);
  await p.selectOption("#eType", "eat");
  check("checkbox hidden for non pee/poop", !(await p.locator("#eAccRow").isVisible()));
  await p.selectOption("#eType", "poop");
  await p.uncheck("#eAcc");
  await p.click('#editDlg button[value="save"]');
  check("unflagging removes badge", await poll(async () => await p.locator(".tl li", { hasText: "Poop" }).first().locator(".acc").count() === 0));

  // long-press accident → log earlier, pee preselected, checkbox on
  await p.locator('.act[data-type="accident"]').scrollIntoViewIfNeeded();
  const box2 = await p.locator('.act[data-type="accident"]').boundingBox();
  await p.mouse.move(box2.x + 40, box2.y + 40); await p.mouse.down(); await p.waitForTimeout(700); await p.mouse.up();
  await p.waitForTimeout(200);
  check("long-press accident: log earlier, Pee + accident checked, no chooser",
    await p.locator("#editDlg").isVisible() && (await p.inputValue("#eType")) === "pee" && await p.isChecked("#eAcc") && !(await p.locator("#accDlg").isVisible()));
  await p.selectOption("#eType", "poop");
  await p.click('#eQuick [data-min="30"]');
  await p.click('#editDlg button[value="save"]');
  check("past poop accident saved", await poll(async () => (await p.locator(".tl li", { hasText: "accident" }).allTextContents()).some(t => t.includes("Poop"))));

  // legacy type:"accident" entry still renders and edits
  await p.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("puppylog.data"));
    d.events.push({ id: "legacy1", type: "accident", ts: Date.now() - 5 * 864e5, note: "old", updated: 1 });
    localStorage.setItem("puppylog.data", JSON.stringify(d));
  });
  await p.reload();
  await p.tap('.chip[data-filter="accident"]');
  check("legacy accident shows in Accident filter", await p.locator('.tl li[data-id="legacy1"]').count() === 1);
  await p.locator('.tl li[data-id="legacy1"]').tap();
  check("legacy accident editable (type kept)", (await p.inputValue("#eType")) === "accident");
  await p.click('#editDlg button[value="cancel"]');
  await p.tap('.chip[data-filter="all"]');
  await p.screenshot({ path: OUT + "7-after.png", fullPage: true });
  await p.context().close();
}

// ================= sync mode: two devices =================
const cfg = { repo: "me/pup", token: "github_pat_TEST", name: "Biscuit" };
const A = await device("A", cfg);
await synced(A);
check("A: first sync with no remote file OK", (await A.textContent("#sync")) === "✓ synced");
check("A: no PUT when nothing to push", gh.puts === 0);

await A.tap('.act[data-type="pee"]');
await A.tap('.act[data-type="drink"]');
await settle(A);
check("A: rapid taps debounced into ≤2 PUTs", gh.puts >= 1 && gh.puts <= 2, `puts=${gh.puts}`);
check("remote has A's 2 events", gh.json.events.length === 2);

const B = await device("B", cfg);
await synced(B);
check("B: pulls A's events on open", await B.locator(".tl li").count() === 2);

// B logs with note containing unicode; conflict forced mid-write
gh.forceConflict = true;
await B.tap('.act[data-type="poop"]');
await settle(B);
check("B: 409 conflict hit", gh.conflicts >= 1, `conflicts=${gh.conflicts}`);
check("B: retry merged — remote has 4 events", gh.json.events.length === 4, `remote=${gh.json.events.length}`);
check("B: shows other device's walk", await B.locator(".tl li", { hasText: "Walk" }).count() === 1);

// B deletes A's pee → A sees delete (tombstone)
await B.locator(".tl li", { hasText: "Pee" }).tap();
await B.click("#eDelete");
await settle(B);
await A.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await settle(A);
check("A: sees B's delete after refocus", await A.locator(".tl li", { hasText: "Pee" }).count() === 0);
check("A: sees B's poop", await A.locator(".tl li", { hasText: "Poop" }).count() === 1);

// concurrent edit: later `updated` wins
await A.locator(".tl li", { hasText: "Drink" }).tap();
await A.fill("#eNote", "a lot 💧");
await A.click('#editDlg button[value="save"]');
await settle(A);
await B.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await settle(B);
check("B: sees A's unicode note edit", (await B.locator(".tl li", { hasText: "Drink" }).textContent()).includes("a lot 💧"));
check("token sent as Bearer", [...gh.auths].every(a => a === "Bearer github_pat_TEST"));
await B.screenshot({ path: OUT + "5-synced.png", fullPage: true });

// bad token → status
await B.context().route("https://api.github.com/**", r => r.fulfill({ status: 401, json: {} }));
await B.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await B.waitForTimeout(500);
check("401 shows '⚠ bad token'", (await B.textContent("#sync")) === "⚠ bad token");
check("local data kept after sync failure", await B.locator(".tl li").count() === 3);

// offline → still logs locally, then syncs on reconnect
await B.context().unroute("https://api.github.com/**");
await B.context().setOffline(true);
await B.tap('.act[data-type="play"]');
await B.waitForTimeout(1500);
check("offline: logs locally, status offline", (await B.locator(".tl li", { hasText: "Play" }).count()) === 1 && (await B.textContent("#sync")) === "⚠ offline");
await B.context().setOffline(false);
await mockGitHub(B.context());
await B.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
await settle(B);
check("back online: offline entry pushed", gh.json.events.some(e => e.type === "play"));

check("no uncaught JS errors", errors.length === 0, errors.join(" | "));

await browser.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
