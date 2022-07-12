import { test, expect } from '@playwright/test';
import { _electron } from 'playwright';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('App launches and quits', async () => {
  test.setTimeout(0);
  const app = await _electron.launch({
    args: ['main.js'],
    recordVideo: {dir: 'test-videos'}
  });
  const window = await app.firstWindow();
  await expect(await window.title()).toContain('Loading');
  await window.waitForSelector('#run-sql-link', {
    timeout: 90000
  });
  await sleep(1000);
  await app.close();
});
