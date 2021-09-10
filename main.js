const {
  app,
  clipboard,
  Menu,
  BrowserWindow,
  dialog,
  shell,
  ipcMain,
} = require("electron");
const EventEmitter = require("events");
const crypto = require("crypto");
const request = require("electron-request");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const portfinder = require("portfinder");
const prompt = require("electron-prompt");
const fs = require("fs");
const { unlink } = require("fs/promises");
const util = require("util");

const execFile = util.promisify(cp.execFile);
const mkdir = util.promisify(fs.mkdir);

const RANDOM_SECRET = crypto.randomBytes(32).toString("hex");

// 'SQLite format 3\0':
const SQLITE_HEADER = Buffer.from("53514c69746520666f726d6174203300", "hex");

const minPackageVersions = {
  datasette: "0.59a2",
  "datasette-app-support": "0.7",
  "datasette-vega": "0.6.2",
  "datasette-cluster-map": "0.17.1",
  "datasette-pretty-json": "0.2.1",
  "datasette-edit-schema": "0.4",
  "datasette-configure-fts": "1.1",
};

let enableDebugMenu = !!process.env.DEBUGMENU;

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
    this.accessControl = "localhost";
    this.cap = 1000;
  }
  on(event, listener) {
    this.logEmitter.on(event, listener);
  }
  async about() {
    const response = await request(
      `http://localhost:${this.port}/-/versions.json`
    );
    const data = await response.json();
    return [
      "An open source multi-tool for exploring and publishing data",
      "",
      `Datasette: ${data.datasette.version}`,
      `Python: ${data.python.version}`,
      `SQLite: ${data.sqlite.version}`,
    ].join("\n");
  }
  async setAccessControl(accessControl) {
    if (accessControl == this.accessControl) {
      return;
    }
    this.accessControl = accessControl;
    await this.startOrRestart();
  }
  log(message, type) {
    if (!message) {
      return;
    }
    type ||= "stdout";
    const item = {
      message: message.replace("INFO:     ", ""),
      type,
      ts: new Date(),
    };
    this.cappedLog.push(item);
    this.logEmitter.emit("log", item);
    this.cappedLog = this.cappedLog.slice(-this.cap);
  }
  serverArgs() {
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
    if (this.accessControl == "network") {
      args.push("--host", "0.0.0.0");
    }
    return args;
  }
  async startOrRestart() {
    const venv_dir = await this.ensureVenv();
    await this.ensurePackagesInstalled();
    const datasette_bin = path.join(venv_dir, "bin", "datasette");
    let backupPath = null;
    if (this.process) {
      // Dump temporary to restore later
      backupPath = path.join(
        app.getPath("temp"),
        `backup-${crypto.randomBytes(8).toString("hex")}.db`
      );
      await this.apiRequest("/-/dump-temporary-to-file", { path: backupPath });
      this.process.kill();
    }
    return new Promise((resolve, reject) => {
      let process;
      try {
        process = cp.spawn(datasette_bin, this.serverArgs(), {
          env: {
            DATASETTE_API_TOKEN: this.apiToken,
            DATASETTE_SECRET: RANDOM_SECRET,
          },
        });
      } catch (e) {
        reject(e);
      }
      this.process = process;
      process.stderr.on("data", async (data) => {
        if (/Uvicorn running/.test(data)) {
          if (backupPath) {
            await this.apiRequest("/-/restore-temporary-from-file", {
              path: backupPath,
            });
            await unlink(backupPath);
          }
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
      process.on("error", (err) => {
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

  async packageVersions() {
    const venv_dir = await this.ensureVenv();
    const pip_path = path.join(venv_dir, "bin", "pip");
    const versionsProcess = await execFile(pip_path, [
      "list",
      "--format",
      "json",
    ]);
    const versions = {};
    for (const item of JSON.parse(versionsProcess.stdout)) {
      versions[item.name] = item.version;
    }
    return versions;
  }

  async ensureVenv() {
    const datasette_app_dir = path.join(process.env.HOME, ".datasette-app");
    const venv_dir = path.join(datasette_app_dir, "venv");
    if (!fs.existsSync(datasette_app_dir)) {
      await mkdir(datasette_app_dir);
    }
    let shouldCreateVenv = true;
    if (fs.existsSync(venv_dir)) {
      // Check Python interpreter still works, using
      // ~/.datasette-app/venv/bin/python3.9 --version
      // See https://github.com/simonw/datasette-app/issues/89
      const venv_python = path.join(venv_dir, "python3.9");
      try {
        await execFile(venv_python, ["--version"]);
      } catch (e) {
        shouldCreateVenv = true;
        fs.rmdirSync(venv_dir, { recursive: true });
      }
    }
    if (shouldCreateVenv) {
      await execFile(findPython(), ["-m", "venv", venv_dir]);
    }
    return venv_dir;
  }

  async ensurePackagesInstalled() {
    const venv_dir = await this.ensureVenv();
    // Anything need installing or upgrading?
    const needsInstall = [];
    for (const [name, requiredVersion] of Object.entries(minPackageVersions)) {
      needsInstall.push(`${name}>=${requiredVersion}`);
    }
    const pip_path = path.join(venv_dir, "bin", "pip");
    try {
      await execFile(pip_path, ["install"].concat(needsInstall));
    } catch (e) {
      dialog.showMessageBox({
        type: "error",
        message: "Error running pip",
        detail: e.toString(),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
      BrowserWindow.getAllWindows()[0].webContents.loadURL(
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

function windowOpts(extraOpts) {
  extraOpts = extraOpts || {};
  let opts = {
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, extraOpts.preload || "preload.js"),
    },
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
    show: false,
    ...windowOpts(),
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

  ipcMain.on("import-csv", async (event, database) => {
    let selectedFiles = dialog.showOpenDialogSync({
      properties: ["openFile"],
    });
    if (!selectedFiles) {
      return;
    }
    let pathToOpen = null;
    const response = await datasette.apiRequest("/-/import-csv-file", {
      path: selectedFiles[0],
      database: database,
    });
    const responseJson = await response.json();
    if (!responseJson.ok) {
      console.log(responseJson);
      dialog.showMessageBox({
        type: "error",
        message: "Error importing CSV file",
        detail: responseJson.error,
      });
    } else {
      pathToOpen = responseJson.path;
    }
    setTimeout(() => {
      datasette.openPath(pathToOpen);
    }, 500);
    event.reply("csv-imported", database);
  });
  let menuTemplate = buildMenu();
  var menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

function buildMenu() {
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

  function buildNetworkChanged(setting) {
    return async function () {
      await datasette.setAccessControl(setting);
      Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenu()));
    };
  }

  const onlyMyComputer = {
    label: "Only my computer",
    type: "radio",
    checked: datasette.accessControl == "localhost",
    click: buildNetworkChanged("localhost"),
  };
  const anyoneOnNetwork = {
    label: "Anyone on my networks",
    type: "radio",
    checked: datasette.accessControl == "network",
    click: buildNetworkChanged("network"),
  };

  // Gather IPv4 addresses
  const ips = new Set();
  for (const [key, networkIps] of Object.entries(os.networkInterfaces())) {
    networkIps.forEach((details) => {
      const ip = details.address;
      if (details.family == "IPv4" && ip != "127.0.0.1") {
        ips.add(ip);
      }
    });
  }

  const accessControlItems = [
    onlyMyComputer,
    anyoneOnNetwork,
    { type: "separator" },
    {
      label: "Open in Browser",
      click() {
        shell.openExternal(`http://localhost:${datasette.port}/`);
      },
    },
  ];
  if (datasette.accessControl == "network") {
    for (let ip of ips) {
      accessControlItems.push({
        label: `Copy http://${ip}:${datasette.port}/`,
        click() {
          clipboard.writeText(`http://${ip}:${datasette.port}/`);
        },
      });
    }
  }

  const menuTemplate = [
    {
      label: "Menu",
      submenu: [
        {
          label: "About Datasette",
          async click() {
            let buttons = ["Visit datasette.io", "OK"];
            if (!enableDebugMenu) {
              buttons.push("Enable Debug Menu");
            }
            dialog
              .showMessageBox({
                type: "info",
                message: "About Datasette",
                detail: await datasette.about(),
                buttons: buttons,
              })
              .then((click) => {
                console.log(click);
                if (click.response == 0) {
                  shell.openExternal("https://datasette.io/");
                }
                if (click.response == 2) {
                  enableDebugMenu = true;
                  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenu()));
                }
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
            newWindow.loadURL(`http://localhost:${datasette.port}`);
            newWindow.once("ready-to-show", () => {
              newWindow.show();
            });
            configureWindow(newWindow);
          },
        },
        { type: "separator" },
        {
          label: "Open Recent",
          role: "recentdocuments",
          submenu: [
            { label: "Clear Recent Items", role: "clearrecentdocuments" },
          ],
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
              app.addRecentDocument(filepath);
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
                app.addRecentDocument(filepath);
                pathToOpen = responseJson.path;
              }
            }
            setTimeout(() => {
              datasette.openPath(pathToOpen);
            }, 500);
          },
        },
        {
          label: "New Empty Database…",
          accelerator: "CommandOrControl+Shift+N",
          click: async () => {
            const filepath = dialog.showSaveDialogSync({
              defaultPath: "database.db",
              title: "Create Empty Database",
            });
            if (!filepath) {
              return;
            }
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
        { type: "separator" },
        {
          label: "Access Control",
          submenu: accessControlItems,
        },
        { type: "separator" },
        {
          role: "close",
        },
      ],
    },
    { role: "editMenu" },
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
            newWindow.loadURL(`http://localhost:${datasette.port}/-/plugins`);
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
  if (enableDebugMenu) {
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
          label: "Package Versions",
          async click() {
            dialog.showMessageBox({
              type: "info",
              message: "Package Versions",
              detail: JSON.stringify(
                await datasette.packageVersions(),
                null,
                2
              ),
            });
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
              browserWindow = new BrowserWindow(
                windowOpts({
                  preload: "server-log-preload.js",
                })
              );
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
        {
          label: "Restart Server",
          async click() {
            await datasette.startOrRestart();
          },
        },
        {
          label: "Stop Server and Copy Command",
          click() {
            datasette.process.kill();
            clipboard.writeText(
              `DATASETTE_API_TOKEN=${datasette.apiToken} datasette ${datasette
                .serverArgs()
                .join(" ")}`
            );
          },
        },
      ],
    });
  }
  return menuTemplate;
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

app.on("open-file", async (event, filepath) => {
  const first16 = await firstBytes(filepath, 16);
  let endpoint;
  let errorMessage;
  if (first16.equals(SQLITE_HEADER)) {
    endpoint = "/-/open-database-file";
    errorMessage = "Error opening database file";
  } else {
    endpoint = "/-/open-csv-file";
    errorMessage = "Error opening CSV file";
  }
  const response = await datasette.apiRequest(endpoint, {
    path: filepath,
  });
  const responseJson = await response.json();
  if (!responseJson.ok) {
    console.log(responseJson);
    dialog.showMessageBox({
      type: "error",
      message: errorMessage,
      detail: responseJson.error,
    });
  } else {
    setTimeout(() => {
      datasette.openPath(responseJson.path);
    });
  }
});

function firstBytes(filepath, bytesToRead) {
  return new Promise((resolve, reject) => {
    fs.open(filepath, "r", function (errOpen, fd) {
      if (errOpen) {
        reject(errOpen);
      } else {
        fs.read(
          fd,
          Buffer.alloc(bytesToRead),
          0,
          bytesToRead,
          0,
          function (errRead, bytesRead, buffer) {
            if (errRead) {
              reject(errRead);
            } else {
              resolve(buffer);
            }
          }
        );
      }
    });
  });
}
