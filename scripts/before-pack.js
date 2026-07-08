// electron-builder beforePack hook.
//
// Builds the vendored datasette-app-support plugin into a wheel so it can be
// bundled into the packaged app's resources (see build.extraResources). At
// runtime appSupportSource() in main.js installs that wheel with `uv pip
// install`. A wheel is used instead of installing from the source tree because
// a source install builds in place and a signed .app bundle's resources are
// read-only.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

exports.default = async function beforePack() {
  const projectDir = path.join(__dirname, "..");
  const uv = path.join(projectDir, "uv", "uv");
  const src = path.join(projectDir, "plugins", "datasette-app-support");
  const outDir = path.join(projectDir, "build", "app-support-wheel");

  // Start from a clean output dir so a stale wheel from a previous build (e.g.
  // an old version number) can't get bundled alongside the current one.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  console.log("beforePack: building datasette-app-support wheel with uv...");
  execFileSync(uv, ["build", "--wheel", src, "--out-dir", outDir], {
    stdio: "inherit",
  });
};
