import { test, expect } from '@playwright/test';
import { _electron } from 'playwright';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('App launches and quits', async () => {
  const app = await _electron.launch({
    args: ['main.js'],
    recordVideo: {dir: 'test-videos'}
  });
  const window = await app.firstWindow();
  await expect(await window.title()).toContain('Loading');
  await window.waitForSelector('#run-sql-link');
  await sleep(1000);
  await app.close();
});
