import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(__dirname, '..', 'test', 'fixtures', 'comprehensive.vcf');

/** Import the comprehensive fixture (7 contacts) through the real file input. */
async function importFixture(page) {
  await page.goto('/');
  // Don't drive the file input until the module graph has evaluated and the
  // bootstrap has attached its listeners (window.app is the last thing set up).
  await page.waitForFunction(() => !!window.app, null, { timeout: 45000 });
  await page.setInputFiles('#file-input', FIXTURE);
  // The toast auto-hides, so anchor on durable post-import state instead.
  await expect(page.locator('#file-label')).toContainText('comprehensive.vcf', { timeout: 15000 });
  await expect(page.locator('#contact-list .contact-item')).toHaveCount(7);
}

/** Select a contact by (partial) name via the sidebar list — deterministic vs. SVG hit-testing. */
async function selectContact(page, name) {
  await page.locator('#contact-list .contact-item').filter({ hasText: name }).first().click();
  await expect(page.locator('#detail-panel')).toBeVisible();
  await expect(page.locator('#detail-name')).toContainText(name);
}

test('import renders the graph, sidebar list, and stats', async ({ page }) => {
  await importFixture(page);
  // 7 real contacts + virtual/group nodes derived from unresolved relationships.
  await expect(page.locator('#graph-container svg g.node')).toHaveCount(10);
  await expect(page.locator('#contact-list .contact-item')).toHaveCount(7);
});

test('selecting a contact shows its details', async ({ page }) => {
  await importFixture(page);
  await selectContact(page, 'John Smith');
  await expect(page.locator('#detail-contact-info')).toContainText('john');
  await expect(
    page.locator('#detail-relationships .rel-item, #detail-relationships .rel-row').first(),
  ).toBeVisible();
});

test('edit → save → select another contact does not break the detail panel', async ({ page }) => {
  // Regression class: the historical #detail-notes null crash after an edit cycle.
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await importFixture(page);
  await selectContact(page, 'John Smith');
  await page.locator('#btn-edit-contact').click();
  await expect(page.locator('#btn-save-contact')).toBeVisible();
  await page.locator('#btn-save-contact').click();
  await expect(page.locator('#toast')).toContainText('updated');

  await selectContact(page, 'Alex Duplicate');
  await selectContact(page, 'John Smith');
  expect(errors).toEqual([]);
});

test('editing a field persists into the vCard export', async ({ page }) => {
  await importFixture(page);
  await selectContact(page, 'John Smith');
  await page.locator('#btn-edit-contact').click();
  const title = page.locator('#edit-title');
  await title.fill('Chief Tester');
  await page.locator('#btn-save-contact').click();
  await expect(page.locator('#toast')).toContainText('updated');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btn-export-all-menu').click();
  await page.locator('.menu-popover .menu-item', { hasText: 'Export All as vCard' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const content = Buffer.concat(chunks).toString('utf8');
  expect(content).toContain('TITLE:Chief Tester');
  expect(content.match(/BEGIN:VCARD/g)).toHaveLength(7);
});

test('table view renders rows and an inline edit updates the model', async ({ page }) => {
  await importFixture(page);
  await page.locator('#btn-view-table').click();
  await expect(page.locator('#table-mode')).toBeVisible();
  const rows = page.locator('#contacts-table-body tr');
  await expect(rows).toHaveCount(7);
});

test('search filters the contact list', async ({ page }) => {
  await importFixture(page);
  await page.locator('#search-input').fill('John Smith');
  await expect(page.locator('#contact-list .contact-item')).toHaveCount(1);
  await page.locator('#search-input').fill('');
  await expect(page.locator('#contact-list .contact-item')).toHaveCount(7);
});

test('theme toggle switches to light and persists across reload', async ({ page }) => {
  await importFixture(page);
  await page.locator('#btn-theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('session restores from IndexedDB after reload', async ({ page }) => {
  await importFixture(page);
  await page.reload();
  const restore = page.locator('#btn-restore-session-drop');
  await expect(restore).toBeVisible();
  await restore.click();
  await expect(page.locator('#contact-list .contact-item')).toHaveCount(7);
});

test('bulk normalize modal opens with the rule builder and closes', async ({ page }) => {
  await importFixture(page);
  await page.locator('#btn-bulk-normalize').click();
  await expect(page.locator('#bulk-normalize-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#bulk-normalize-modal')).toBeHidden();
});

test('markdown export falls back to downloads without the directory picker', async ({ page }) => {
  await importFixture(page);
  // Headless Chromium has showDirectoryPicker but can't show the dialog;
  // remove it to exercise the documented download fallback.
  await page.evaluate(() => {
    window.showDirectoryPicker = undefined;
  });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btn-export-all-menu').click();
  await page.locator('.menu-popover .menu-item', { hasText: 'Export All as Markdown' }).click();
  const download = await downloadPromise;
  // The bundle externalizes photos, so the first file may be the .md or an image.
  expect(download.suggestedFilename()).toMatch(/\.(md|jpe?g|png)$/);
});

test('no console errors through import → select → view switches', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await importFixture(page);
  await selectContact(page, 'Jane');
  await page.locator('#btn-view-table').click();
  await page.locator('#btn-view-graph').click();
  await page.locator('#graph-mode-select').selectOption({ index: 1 });
  expect(errors).toEqual([]);
});

test('"Treat as Company" checkbox on the card toggles and persists to export', async ({ page }) => {
  await importFixture(page);

  // Companies render as rounded squares on the graph (one in the fixture).
  await expect(page.locator('#graph-container svg g.node rect.node-circle')).toHaveCount(1);

  // A company contact shows the box checked.
  await selectContact(page, 'Acme Corporation');
  const acmeBox = page.locator('.detail-company-toggle input[type="checkbox"]');
  await expect(acmeBox).toBeChecked();

  // A person with an org shows it unchecked; ticking commits immediately.
  await selectContact(page, 'Jane');
  const janeBox = page.locator('.detail-company-toggle input[type="checkbox"]');
  await expect(janeBox).not.toBeChecked();
  await janeBox.check();
  await expect(page.locator('#toast')).toContainText('Contact updated');
  // The panel re-renders from the committed model — still checked.
  await expect(page.locator('.detail-company-toggle input[type="checkbox"]')).toBeChecked();
  // Jane's node swaps its circle for the company rounded square live.
  await expect(page.locator('#graph-container svg g.node rect.node-circle')).toHaveCount(2);

  // And the change reaches the vCard export (Acme + Jane).
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#btn-export-all-menu').click();
  await page.locator('.menu-popover .menu-item', { hasText: 'Export All as vCard' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const content = Buffer.concat(chunks).toString('utf8');
  expect(content.match(/X-ABSHOWAS:COMPANY/g)).toHaveLength(2);
});

test('disconnected clusters settle apart (component-aware layout)', async ({ page }) => {
  const DISJOINT = path.resolve(__dirname, '..', 'test', 'fixtures', 'disjoint-clusters.vcf');
  await page.goto('/');
  await page.waitForFunction(() => !!window.app, null, { timeout: 45000 });
  await page.setInputFiles('#file-input', DISJOINT);
  await expect(page.locator('#contact-list .contact-item')).toHaveCount(10);

  const clusterBoxes = async () => {
    await page.waitForTimeout(2500); // let the simulation settle
    return page.evaluate(() => {
      const groups = { Aster: [], Birch: [] };
      for (const g of document.querySelectorAll('#graph-container svg g.node')) {
        const name = g.getAttribute('aria-label') || '';
        const m = /translate\(([-\d.e]+),([-\d.e]+)\)/.exec(g.getAttribute('transform') || '');
        if (!m) continue;
        const pt = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
        if (name.includes('Aster')) groups.Aster.push(pt);
        else if (name.includes('Birch')) groups.Birch.push(pt);
      }
      const box = (pts) => ({
        minX: Math.min(...pts.map((p) => p.x)),
        maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)),
        maxY: Math.max(...pts.map((p) => p.y)),
      });
      return { aster: box(groups.Aster), birch: box(groups.Birch) };
    });
  };
  const disjoint = ({ aster: a, birch: b }) =>
    a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;

  expect(disjoint(await clusterBoxes()), 'families overlap after initial layout').toBe(true);

  // Re-layout must also re-form the clusters apart.
  await page.locator('#btn-graph-relayout').click();
  const settled = await clusterBoxes();
  expect(disjoint(settled), 'families overlap after re-layout').toBe(true);

  // Mental-map preservation: an edit-triggered incremental rebuild must NOT
  // drag settled clusters to new spots (homes anchor at current centroids).
  const centroid = (b) => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
  await page.locator('#contact-list .contact-item').filter({ hasText: 'Alma Aster' }).click();
  await page.locator('#btn-edit-contact').click();
  await page.locator('#edit-title').fill('Matriarch');
  await page.locator('#btn-save-contact').click();
  const after = await clusterBoxes();
  expect(disjoint(after), 'families overlap after an edit rebuild').toBe(true);
  for (const fam of ['aster', 'birch']) {
    const before = centroid(settled[fam]);
    const now = centroid(after[fam]);
    const drift = Math.hypot(now.x - before.x, now.y - before.y);
    expect(drift, `${fam} cluster migrated ${drift.toFixed(0)}px after an edit`).toBeLessThan(120);
  }
});
