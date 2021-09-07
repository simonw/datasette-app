const { app, Menu, BrowserWindow, dialog, shell } = require("electron");
const EventEmitter = require("events");
const crypto = require("crypto");
const request = require("electron-request");
const path = require("path");
const cp = require("child_process");
const portfinder = require("portfinder");
const prompt = require("electron-prompt");
const fs = require("fs");
const util = require("util");

const execFile = util.promisify(cp.execFile);
const mkdir = util.promisify(fs.mkdir);

function configureWindow(window) {
  window.webContents.on("will-navigate", function (event, reqUrl) {
    // Links to external sites should open in system browser
    let requestedHost = new URL(reqUrl).host;
    let currentHost = new URL(window.webContents.getURL()).host;
    if (requestedHost && requestedHost != currentHost) {
      event.preventDefault();
      shell.openExternal(reqUrl);
    }
  });
  window.webContents.on("did-navigate", (event, reqUrl) => {
    // Update back/forward button enable status
    let menu = Menu.getApplicationMenu();
    if (!menu) {
      return;
    }
    let backItem = menu.getMenuItemById("back-item");
    let forwardItem = menu.getMenuItemById("forward-item");
    if (backItem) {
      backItem.enabled = window.webContents.canGoBack();
    }
    if (forwardItem) {
      forwardItem.enabled = window.webContents.canGoForward();
    }
  });
}

class DatasetteServer {
  constructor(app, port) {
    this.app = app;
    this.port = port;
    this.process = null;
    this.apiToken = crypto.randomBytes(32).toString("hex");
    this.logEmitter = new EventEmitter();
    this.cappedLog = [];
    this.cap = 1000;
  }
  on(event, listener) {
    this.logEmitter.on(event, listener);
  }
  log(message, type) {
    if (!message) {
      return;
    }
    type ||= "stdout";
    const item = {
      message,
      type,
      ts: new Date(),
    };
    this.cappedLog.push(item);
    this.logEmitter.emit("log", item);
    this.cappedLog = this.cappedLog.slice(-this.cap);
  }
  async startOrRestart() {
    const datasette_bin = await this.ensureDatasetteInstalled();
    const args = [
      "--port",
      this.port,
      "--version-note",
      "xyz-for-datasette-app",
      "--setting",
      "sql_time_limit_ms",
      "10000",
      "--setting",
      "max_returned_rows",
      "2000",
      "--setting",
      "facet_time_limit_ms",
      "1000",
      "--setting",
      "max_csv_mb",
      "0",
    ];
    if (this.process) {
      this.process.kill();
    }
    return new Promise((resolve, reject) => {
      const process = cp.spawn(datasette_bin, args, {
        env: {
          DATASETTE_API_TOKEN: this.apiToken,
        },
      });
      this.process = process;
      process.stderr.on("data", (data) => {
        if (/Uvicorn running/.test(data)) {
          resolve(`http://localhost:${this.port}/`);
        }
        for (const line of data.toString().split("\n")) {
          this.log(line, "stderr");
        }
      });
      process.stdout.on("data", (data) => {
        for (const line of data.toString().split("\n")) {
          this.log(line);
        }
      });
      this.process.on("error", (err) => {
        console.error("Failed to start datasette", err);
        this.app.quit();
        reject();
      });
    });
  }

  shutdown() {
    this.process.kill();
  }

  async apiRequest(path, body) {
    return await request(`http://localhost:${this.port}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
    });
  }

  async installPlugin(plugin) {
    const pip_binary = path.join(
      process.env.HOME,
      ".datasette-app",
      "venv",
      "bin",
      "pip"
    );
    await execFile(pip_binary, ["install", plugin]);
  }

  async ensureDatasetteInstalled() {
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
      "datasette-app-support>=0.3",
    ]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return datasette_binary;
  }

  openPath(path, opts) {
    path = path || "/";
    opts = opts || {};
    const loadUrlOpts = {
      extraHeaders: `authorization: Bearer ${this.apiToken}`,
      method: "POST",
      postData: [
        {
          type: "rawData",
          bytes: Buffer.from(JSON.stringify({ redirect: path })),
        },
      ],
    };
    if (
      BrowserWindow.getAllWindows().length == 1 &&
      (opts.forceMainWindow ||
        new URL(BrowserWindow.getFocusedWindow().webContents.getURL())
          .pathname == "/")
    ) {
      // Re-use the single existing window
      BrowserWindow.getFocusedWindow().webContents.loadURL(
        `http://localhost:${this.port}/-/auth-app-user`,
        loadUrlOpts
      );
    } else {
      // Open a new window
      let newWindow = new BrowserWindow({
        ...windowOpts(),
        ...{ show: false },
      });
      newWindow.loadURL(
        `http://localhost:${this.port}/-/auth-app-user`,
        loadUrlOpts
      );
      newWindow.once("ready-to-show", () => {
        newWindow.show();
      });
      configureWindow(newWindow);
    }
  }
}

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

let datasette = null;

async function initializeApp() {
  /* We don't use openPath here because we want to control the transition from the
     loading.html page to the index page once the server has started up */
  let mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
  });
  mainWindow.loadFile("loading.html");
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  configureWindow(mainWindow);
  let freePort = null;
  try {
    freePort = await portfinder.getPortPromise({ port: 8001 });
  } catch (err) {
    console.error("Failed to obtain a port", err);
    app.quit();
  }
  // Start Python Datasette process (if one is not yet running)
  if (!datasette) {
    datasette = new DatasetteServer(app, freePort);
  }
  datasette.on("log", (item) => {
    console.log(item);
  });
  await datasette.startOrRestart();
  datasette.openPath("/", {
    forceMainWindow: true,
  });
  app.on("will-quit", () => {
    datasette.shutdown();
  });
  const homeItem = {
    label: "Home",
    click() {
      let window = BrowserWindow.getFocusedWindow();
      if (window) {
        const url = new URL("/", window.webContents.getURL());
        window.webContents.loadURL(url.toString());
      }
    },
  };
  const backItem = {
    label: "Back",
    id: "back-item",
    accelerator: "CommandOrControl+[",
    click() {
      let window = BrowserWindow.getFocusedWindow();
      if (window) {
        window.webContents.goBack();
      }
    },
    enabled: false,
  };
  const forwardItem = {
    label: "Forward",
    id: "forward-item",
    accelerator: "CommandOrControl+]",
    click() {
      let window = BrowserWindow.getFocusedWindow();
      if (window) {
        window.webContents.goForward();
      }
    },
    enabled: false,
  };

  app.on("browser-window-focus", (event, window) => {
    forwardItem.enabled = window.webContents.canGoForward();
    backItem.enabled = window.webContents.canGoBack();
  });

  let menuTemplate = [
    {
      label: "Menu",
      submenu: [
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
    {
      label: "File",
      submenu: [
        {
          label: "New Window",
          accelerator: "CommandOrControl+N",
          click() {
            let newWindow = new BrowserWindow({
              ...windowOpts(),
              ...{ show: false },
            });
            newWindow.loadURL(`http://localhost:${freePort}`);
            newWindow.once("ready-to-show", () => {
              newWindow.show();
            });
            configureWindow(newWindow);
          },
        },
        { type: "separator" },
        {
          label: "New Empty Database…",
          accelerator: "CommandOrControl+Shift+N",
          click: async () => {
            const filepath = dialog.showSaveDialogSync({
              defaultPath: "database.db",
              title: "Create Empty Database",
            });
            const response = await datasette.apiRequest(
              "/-/new-empty-database-file",
              { path: filepath }
            );
            const responseJson = await response.json();
            if (!responseJson.ok) {
              console.log(responseJson);
              dialog.showMessageBox({
                type: "error",
                title: "Datasette",
                message: responseJson.error,
              });
            } else {
              datasette.openPath(responseJson.path);
            }
          },
        },
        {
          label: "Open CSV…",
          accelerator: "CommandOrControl+O",
          click: async () => {
            let selectedFiles = dialog.showOpenDialogSync({
              properties: ["openFile", "multiSelections"],
            });
            if (!selectedFiles) {
              return;
            }
            let pathToOpen = null;
            for (const filepath of selectedFiles) {
              const response = await datasette.apiRequest("/-/open-csv-file", {
                path: filepath,
              });
              const responseJson = await response.json();
              if (!responseJson.ok) {
                console.log(responseJson);
                dialog.showMessageBox({
                  type: "error",
                  message: "Error opening CSV file",
                  detail: responseJson.error,
                });
              } else {
                pathToOpen = responseJson.path;
              }
            }
            setTimeout(() => {
              datasette.openPath(pathToOpen);
            }, 500);
          },
        },
        {
          label: "Open Database…",
          accelerator: "CommandOrControl+D",
          click: async () => {
            let selectedFiles = dialog.showOpenDialogSync({
              properties: ["openFile", "multiSelections"],
            });
            if (!selectedFiles) {
              return;
            }
            let pathToOpen = null;
            for (const filepath of selectedFiles) {
              const response = await datasette.apiRequest(
                "/-/open-database-file",
                { path: filepath }
              );
              const responseJson = await response.json();
              if (!responseJson.ok) {
                console.log(responseJson);
                dialog.showMessageBox({
                  type: "error",
                  message: "Error opening database file",
                  detail: responseJson.error,
                });
              } else {
                pathToOpen = responseJson.path;
              }
            }
            setTimeout(() => {
              datasette.openPath(pathToOpen);
            }, 500);
          },
        },
        { type: "separator" },
        {
          role: "close",
        },
      ],
    },
    {
      label: "Navigate",
      submenu: [
        homeItem,
        backItem,
        forwardItem,
        {
          label: "Reload Current Page",
          accelerator: "CommandOrControl+R",
          click() {
            let window = BrowserWindow.getFocusedWindow();
            if (window) {
              window.webContents.reload();
            }
          },
        },
      ],
    },
    {
      label: "Plugins",
      submenu: [
        {
          label: "Install Plugin…",
          click() {
            prompt({
              title: "Install Plugin",
              label: "Plugin name:",
              value: "datasette-vega",
              type: "input",
              alwaysOnTop: true,
            })
              .then(async (pluginName) => {
                if (pluginName !== null) {
                  await datasette.installPlugin(pluginName);
                  await datasette.startOrRestart();
                  dialog.showMessageBoxSync({
                    type: "info",
                    message: "Plugin installed",
                  });
                }
              })
              .catch(console.error);
          },
        },
        {
          label: "List Installed Plugins",
          click() {
            let newWindow = new BrowserWindow({
              ...windowOpts(),
              ...{ show: false },
            });
            newWindow.loadURL(`http://localhost:${freePort}/-/plugins`);
            newWindow.once("ready-to-show", () => {
              newWindow.show();
            });
            configureWindow(newWindow);
          },
        },
        {
          label: "Plugins Directory",
          click() {
            shell.openExternal("https://datasette.io/plugins");
          },
        },
      ],
    },
  ];
  if (process.env.DEBUGMENU) {
    menuTemplate.push({
      label: "Debug",
      submenu: [
        {
          label: "Open DevTools",
          click() {
            BrowserWindow.getFocusedWindow().webContents.openDevTools();
          },
        },
        {
          label: "Show Server Log",
          click() {
            /* Is it open already? */
            let browserWindow = null;
            let existing = BrowserWindow.getAllWindows().filter((bw) =>
              bw.webContents.getURL().endsWith("/server-log.html")
            );
            if (existing.length) {
              browserWindow = existing[0];
              browserWindow.focus();
            } else {
              browserWindow = new BrowserWindow({
                webPreferences: {
                  preload: path.join(__dirname, "server-log-preload.js"),
                },
                ...windowOpts(),
              });
              browserWindow.loadFile("server-log.html");
              datasette.on("log", (item) => {
                !browserWindow.isDestroyed() &&
                  browserWindow.webContents.send("log", item);
              });
              for (const item of datasette.cappedLog) {
                browserWindow.webContents.send("log", item);
              }
            }
          },
        },
      ],
    });
  }
  var menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  await initializeApp();
  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      datasette.openPath("/");
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});
