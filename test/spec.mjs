import { test, expect } from '@playwright/test';
import { _electron } from 'playwright';

test('App launches and quits', async () => {
  const app = await _electron.launch({ args: ['main.js'] });
  const window = await app.firstWindow();
  await expect(await window.title()).toContain('Loading');
  await window.waitForSelector('#run-sql-link');
  await app.close();
});
