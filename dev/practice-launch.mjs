// The kit's mock host cannot launch an add-on as a practice-v1 activity (props.practice), which is how the app
// opens it from Session Mode, the recall queue and the planner. This adds props.practice to the `init` message
// inside the frame and checks that the add-on opens that activity directly (no list, no Back button) and reports
// a practice result.
//
//   (in the kit folder)  bun run dev "../../Exam Room" --port 4174
//   node dev/practice-launch.mjs http://127.0.0.1:4174
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = process.env.MNX_KIT || resolve(HERE, '..', '..', 'mnx-addon-kit-release');
const { chromium } = createRequire(join(KIT, 'package.json'))('playwright');
const url = process.argv[2] || 'http://127.0.0.1:4174';
const activityId = process.argv[3] || 'gem-p2425-q05';

const browser = await chromium.launch({ executablePath: process.env.MNX_CHROMIUM || undefined });
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };

for (const surface of ['standalone']) { // the mock host launches the standalone surface; props.practice is what the app adds
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(({ activityId, surface }) => {
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data && data.kind === 'init' && data.props && !data.props.kind?.startsWith?.('addon-job')) {
        data.props.practice = { version: 1, activityId, launch: { a: activityId }, reason: 'it matches what you are studying', timeBudgetSeconds: 600 };
      }
    }, true);
  }, { activityId, surface });
  const page = await context.newPage();
  await page.goto(`${url}?scenario=standalone-list&theme=light`);
  await page.evaluate(() => window.__mnxMock.ready());
  await page.evaluate(() => window.__mnxMock.launch());
  await page.waitForFunction(() => window.__mnxMock.snapshot().currentReady);
  const frame = page.frameLocator('#addon-frame');
  await frame.locator('[data-answer]').first().waitFor({ state: 'visible', timeout: 8000 });
  check(await frame.locator('[data-view=home]').count() === 0, `${surface}: opens the activity, not the list`);
  check(await frame.locator('[data-action=back]').count() === 0, `${surface}: no Back button`);
  check((await frame.locator('.er-intro').innerText()).includes('Offered because: it matches what you are studying'), `${surface}: shows why it was offered`);
  await frame.locator('[data-answer]').first().fill('Changes to domain IV could alter DnaA binding to the DnaA boxes at oriC and so the frequency of origin firing.');
  await frame.locator('[data-action=finish-writing]').click();
  await frame.locator('[data-point]').first().click();
  await frame.locator('[data-action=finish-marking]').click();
  const state = await page.waitForFunction(() => window.__mnxMock.snapshot().results.length > 0).then(() => page.evaluate(() => window.__mnxMock.snapshot()));
  const row = state.results.at(-1);
  check(row.ok, `${surface}: the host's checks pass the result${row.ok ? '' : ` (${row.checks.filter((c) => !c.pass).map((c) => c.rule).join('; ')})`}`);
  check(state.errors.length === 0, `${surface}: no errors`);
  await context.close();
}
await browser.close();
process.exitCode = problems.length ? 1 : 0;
