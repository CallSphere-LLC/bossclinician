// Uses disposable accounts from a mode-600 fixture outside the repository.
// Run with AFTER=1 after deployment to require focus refresh and verify revocation.
const { chromium } = require('/tmp/club-gap-audit/node_modules/playwright-core');
const fs = require('fs');
const assert = require('assert');
const fixture = JSON.parse(fs.readFileSync(process.env.ACCESS_FIXTURE || '/tmp/boss-access-fixture.json'));
const BASE = 'https://bossclinician.callsphere.site';
const ADMIN = 'https://admin.bossclinician.callsphere.site';
const courseLink = 'a[href="/library/directory-makeover-audit"]';
(async () => {
  const health = await (await fetch(BASE + '/api/health')).json();
  if (process.env.EXPECTED_RELEASE) assert.equal(health.release, process.env.EXPECTED_RELEASE);
  const browser = await chromium.launch({ executablePath: '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', args: ['--no-sandbox'] });
  try {
    const member = await browser.newPage();
    const admin = await browser.newPage();
    member.setDefaultTimeout(15000);
    admin.setDefaultTimeout(15000);
    const pageErrors = [];
    member.on('pageerror', error => pageErrors.push(error.message));
    admin.on('pageerror', error => pageErrors.push(error.message));
    for (const [page, url, email] of [[member, BASE + '/login', fixture.memberEmail], [admin, ADMIN + '/admin/login', fixture.adminEmail]]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.locator('input[type=email]').fill(email);
      await page.locator('input[type=password]').fill(fixture.password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL(url => !url.pathname.includes('login'));
    }
    await admin.goto(ADMIN + '/admin/contacts/' + fixture.contactId, { waitUntil: 'networkidle' });
    async function revoke() {
      await admin.getByRole('button', { name: 'Revoke', exact: true }).click();
      await admin.getByRole('button', { name: 'Yes, take it away', exact: true }).click();
      await admin.getByText('Access taken away', { exact: true }).first().waitFor();
      await admin.getByRole('button', { name: 'Revoke', exact: true }).waitFor({ state: 'hidden' });
    }
    if (await admin.getByRole('button', { name: 'Revoke', exact: true }).count()) await revoke();
    await member.goto(BASE + '/library', { waitUntil: 'networkidle' });
    assert.equal(await member.locator(courseLink).count(), 0);
    await admin.bringToFront();
    await admin.getByRole('button', { name: 'Grant an offer', exact: true }).click();
    await admin.getByRole('dialog').locator('select').selectOption('32');
    await admin.getByRole('dialog').getByRole('button', { name: 'Give them access', exact: true }).click();
    await admin.getByText(/Access given/).first().waitFor();
    await member.bringToFront();
    // Headless Chromium does not consistently dispatch focus on bringToFront.
    await member.evaluate(() => window.dispatchEvent(new Event('focus')));
    if (process.env.AFTER) await member.locator(courseLink).waitFor();
    else await member.waitForTimeout(1800);
    const visibleOnReturn = await member.locator(courseLink).count() > 0;
    await member.screenshot({ path: __dirname + (process.env.AFTER ? '/after-return.png' : '/before-return.png'), fullPage: true });
    await member.reload({ waitUntil: 'networkidle' });
    const visibleAfterReload = await member.locator(courseLink).count() > 0;
    const result = { release: health.release, verifiedAt: new Date().toISOString(), visibleOnReturn, visibleAfterReload, pageErrors };
    assert(visibleAfterReload);
    if (process.env.AFTER) {
      assert(visibleOnReturn);
      await member.locator(courseLink).first().click();
      await member.getByRole('link', { name: /lesson 1/i }).first().click();
      const lesson = member.locator('nav[aria-label="Course outline"] a').first();
      await lesson.waitFor();
      await lesson.hover();
      await member.waitForTimeout(250);
      const arrow = lesson.locator('svg').last();
      result.lessonArrowHoverTransform = await arrow.evaluate(node => getComputedStyle(node).transform);
      assert.notEqual(result.lessonArrowHoverTransform, 'none');
      await member.screenshot({ path: __dirname + '/course-outline-hover.png', fullPage: true });
      await member.emulateMedia({ reducedMotion: 'reduce' });
      result.lessonArrowReducedMotionTransform = await arrow.evaluate(node => getComputedStyle(node).transform);
      assert.equal(result.lessonArrowReducedMotionTransform, 'none');
      await member.goto(BASE + '/library', { waitUntil: 'networkidle' });
      await admin.bringToFront();
      await revoke();
      await member.bringToFront();
      await member.evaluate(() => window.dispatchEvent(new Event('focus')));
      await member.locator(courseLink).waitFor({ state: 'hidden' });
      result.revocationReflectedOnReturn = true;
      await member.screenshot({ path: __dirname + '/after-revoke.png', fullPage: true });
      assert.equal(pageErrors.length, 0, pageErrors.join('\n'));
    }
    if (process.env.EXPECTED_RELEASE) assert.equal((await (await fetch(BASE + '/api/health')).json()).release, process.env.EXPECTED_RELEASE);
    fs.writeFileSync(__dirname + (process.env.AFTER ? '/after.json' : '/before.json'), JSON.stringify(result, null, 2));
    console.log(result);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
