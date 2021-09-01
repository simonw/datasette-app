const { app, Menu, BrowserWindow, dialog } = require("electron");
const request = require("electron-request");
const path = require("path");
const cp = require("child_process");
const portfinder = require("portfinder");
const fs = require("fs");
const util = require("util");

const execFile = util.promisify(cp.execFile);
const mkdir = util.promisify(fs.mkdir);

function findPython() {
  const possibilities = [
    // In packaged app
    path.join(process.resourcesPath, "python", "bin", "python3.9"),
    // In development
    path.join(__dirname, "python", "bin", "python3.9"),
  ];
  for (const path of possibilities) {
    if (fs.existsSync(path)) {
      return path;
    }
  }
  console.log("Could not find python3, checked", possibilities);
  app.quit();
}

function windowOpts() {
  let opts = {
    width: 800,
    height: 600,
  };
  if (BrowserWindow.getFocusedWindow()) {
    const pos = BrowserWindow.getFocusedWindow().getPosition();
    opts.x = pos[0] + 22;
    opts.y = pos[1] + 22;
  }
  return opts;
}

async function ensureDatasetteInstalled() {
  const datasette_app_dir = path.join(process.env.HOME, ".datasette-app");
  const venv_dir = path.join(datasette_app_dir, "venv");
  const datasette_binary = path.join(venv_dir, "bin", "datasette");
  if (fs.existsSync(datasette_binary)) {
    return datasette_binary;
  }
  if (!fs.existsSync(datasette_app_dir)) {
    await mkdir(datasette_app_dir);
  }
  if (!fs.existsSync(venv_dir)) {
    await execFile(findPython(), ["-m", "venv", venv_dir]);
  }
  const pip_path = path.join(venv_dir, "bin", "pip");
  await execFile(pip_path, [
    "install",
    "datasette==0.59a2",
    "datasette-app-support>=0.1.2",
  ]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  return datasette_binary;
}

function createWindow() {
  let datasette = null;
  let port = null;
  let mainWindow = null;

  function startDatasette(app) {
    if (datasette) {
      datasette.kill();
    }
    const args = [
      "--memory",
      "--port",
      port,
      "--version-note",
      "xyz-for-datasette-app",
    ];
    ensureDatasetteInstalled().then((datasette_bin) => {
      datasette = cp.spawn(datasette_bin, args);
      datasette.stderr.on("data", (data) => {
        if (/Uvicorn running/.test(data)) {
          mainWindow.loadURL(`http://localhost:${port}`);
        }
      });
      datasette.on("error", (err) => {
        console.error("Failed to start datasette", err);
        app.quit();
      });
    });
  }

  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
  });
  mainWindow.loadFile("loading.html");
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  portfinder.getPort(
    {
      port: 8001,
    },
    (err, freePort) => {
      if (err) {
        console.error("Failed to obtain a port", err);
        app.quit();
      }
      port = freePort;
      // Start Python Datasette process
      startDatasette(app);
      app.on("will-quit", () => {
        datasette.kill();
      });

      var menu = Menu.buildFromTemplate([
        {
          label: "Menu",
          submenu: [
            {
              label: "New Window",
              accelerator: "CommandOrControl+N",
              click() {
                let newWindow = new BrowserWindow({
                  ...windowOpts(),
                  ...{ show: false },
                });
                newWindow.loadURL(`http://localhost:${port}`);
                newWindow.once("ready-to-show", () => {
                  newWindow.show();
                });
              },
            },
            {
              label: "Open Database…",
              accelerator: "CommandOrControl+O",
              click: async () => {
                let selectedFiles = dialog.showOpenDialogSync({
                  properties: ["openFile", "multiSelections"],
                });
                for (const filepath of selectedFiles) {
                  const response = await request(
                    `http://localhost:${port}/-/open-database-file`,
                    {
                      method: "POST",
                      body: JSON.stringify({ path: filepath }),
                    }
                  );
                  if (!response.ok) {
                    console.log(await response.json());
                  }
                }
                setTimeout(() => {
                  let shouldOpen = true;
                  BrowserWindow.getAllWindows().forEach((win) => {
                    let url = new URL(win.webContents.getURL());
                    if (url.pathname == "/") {
                      shouldOpen = false;
                      setTimeout(() => win.webContents.reload(), 300);
                    }
                  });
                  if (shouldOpen) {
                    // Open a new window
                    let newWindow = new BrowserWindow({
                      ...windowOpts(),
                      ...{ show: false },
                    });
                    newWindow.loadURL(`http://localhost:${port}`);
                    newWindow.once("ready-to-show", () => {
                      newWindow.show();
                    });
                  }
                }, 500);
              },
            },
            { type: "separator" },
            {
              role: "close",
            },
            { type: "separator" },
            {
              label: "About Datasette",
              click() {
                dialog.showMessageBox({
                  type: "info",
                  title: "Datasette",
                  message: cp.execSync("datasette --version").toString(),
                });
              },
            },
            { type: "separator" },
            {
              role: "quit",
            },
          ],
        },
      ]);
      Menu.setApplicationMenu(menu);
    }
  );
  // mainWindow.webContents.openDevTools()
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
