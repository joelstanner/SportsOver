// The import button opens one picker and reports validation/save results in place.
const { chromium } = require('../../scripts/test-browser.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');

(async () => {
  const browser = await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  try {
    let state = {initialized:false,config:null,revision:0,instance:'import-test',catalogRevision:0};
    let failSave = false;
    const errors = [], writes = [];
    const context = await browser.newContext({viewport:{width:960,height:850},acceptDownloads:true});
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.fulfill({json:{events:[],dates:[]}});
      if (url.pathname.startsWith('/api/sports/state')) {
        if (route.request().method() !== 'GET') {
          writes.push(route.request().postDataJSON());
          if (failSave) return route.fulfill({status:503,json:{detail:'Connection failed. Try importing again.'}});
          state = {...state,initialized:true,revision:state.revision + 1,config:writes.at(-1).config};
        }
        return route.fulfill({json:state});
      }
      let relative = url.pathname.replace(/^\/sports\//, '');
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
      try { return route.fulfill({body:await fs.readFile(path.join(root,relative)),contentType:types[path.extname(relative)]}); }
      catch (_) { return route.fulfill({status:404,body:''}); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8000/sports/admin/');
    const card = page.getByRole('region',{name:'Settings backup'});
    const button = card.getByRole('button',{name:'Import settings…',exact:true});
    const input = card.locator('input[type=file]');
    const status = card.locator('.settings-import-status');
    await button.waitFor();
    assert.equal(await input.isVisible(),false);
    // Keyboard activation reaches the native file picker; cancellation is quiet.
    await button.focus();
    const picker = page.waitForEvent('filechooser');
    await button.press('Enter');
    await (await picker).setFiles([]);
    assert.equal(await status.textContent(),'');
    assert.equal(writes.length,0);
    async function choose(buffer) {
      const picker = page.waitForEvent('filechooser');
      await button.click();
      await (await picker).setFiles({name:'sports-settings.json',mimeType:'application/json',buffer});
    }
    for (const [buffer,message] of [
      [Buffer.from('invalid JSON'),'Could not read this backup.'],
      [Buffer.from('{}'),'This file is not an exported sports configuration.'],
      [Buffer.alloc(262145),'Choose a settings backup smaller than 256 KB.'],
    ]) {
      await choose(buffer);
      await page.waitForFunction(message => document.querySelector('.settings-import-status').textContent.includes(message),message);
      assert.equal(await input.inputValue(),'');
      assert.equal(await button.isEnabled(),true);
      assert.equal(writes.length,0);
    }
    const config = await page.evaluate(() => ({...window.SportsOverlay.config.loadConfig(),timeZone:'America/Chicago'}));
    // An older export has only effective per-sport intervals.
    delete config.providerRefreshPolicy;
    config.providerRefreshSeconds.baseball.live = 45;
    const backup = Buffer.from(JSON.stringify(config));
    failSave = true;
    await choose(backup);
    await status.getByText('Connection failed. Try importing again.',{exact:true}).waitFor();
    assert.equal(await button.isEnabled(),true);
    assert.equal(state.initialized,false);
    failSave = false;
    await choose(backup);
    await status.getByText('Imported sports-settings.json. Your settings are now applied.',{exact:true}).waitFor();
    assert.equal(state.config.timeZone,'America/Chicago');
    assert.deepEqual(state.config.providerRefreshSeconds, config.providerRefreshSeconds);
    assert.equal(state.config.providerRefreshPolicy.shared.live, 12);
    assert.deepEqual(state.config.providerRefreshPolicy.overrides.baseball, ['live']);
    assert.equal(await page.locator('#provider-refresh-fields input[data-state="live"]').inputValue(), '12');
    assert.equal(await page.locator('#time-zone').inputValue(),'America/Chicago');
    assert.equal(await button.isDisabled(),true,'initialized shared control retains its import restriction');
    const download = page.waitForEvent('download');
    await card.getByRole('button',{name:'Export settings',exact:true}).click();
    const exported = await download;
    assert.equal(exported.suggestedFilename(),'sports-settings.json');
    const exportedConfig = JSON.parse(await fs.readFile(await exported.path(),'utf8'));
    assert.equal(exportedConfig.timeZone,'America/Chicago');
    assert.deepEqual(exportedConfig.providerRefreshSeconds, state.config.providerRefreshSeconds);
    assert.deepEqual(exportedConfig.providerRefreshPolicy, state.config.providerRefreshPolicy);
    await card.screenshot({path:'/tmp/sportsover-settings-backup.png'});
    await page.setViewportSize({width:360,height:850});
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth),true);
    await card.screenshot({path:'/tmp/sportsover-settings-backup-narrow.png'});
    assert.deepEqual(errors,[]);
    console.log('Settings import passed: keyboard picker, cancel, validation, failed save/retry, import, export, narrow layout.');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode = 1;});
