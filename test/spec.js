const Application = require("spectron").Application;
const assert = require("assert");
const electronPath = require("electron");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Application launch", function () {
  this.timeout(10000);

  beforeEach(async function () {
    this.app = new Application({
      path: electronPath,
      args: [path.join(__dirname, "..")],
    });
    return this.app.start();
  });

  afterEach(function () {
    if (this.app && this.app.isRunning()) {
      return this.app.stop();
    }
  });

  it("shows an initial window", async function () {
    await sleep(1000);
    this.app.client.getWindowCount().then(function (count) {
      assert.strictEqual(count, 1);
      done();
    });
  });
});
