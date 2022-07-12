const { _electron: electron } = require('playwright');

describe("Application launch", function () {
  this.timeout(30000);

  beforeEach(async function () {
    this.app = await electron.launch({ args: ['main.js'] });
  });

  afterEach(async function () {
    await this.app.close();
  });

  it("shows an initial window", async function () {
    const window = await this.app.firstWindow();
    await window.waitForSelector('#run-sql-link');
  });
});
