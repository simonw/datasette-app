const { app, Menu, BrowserWindow, dialog } = require("electron");
const request = require("electron-request");
const path = require("path");
const cp = require("child_process");
const portfinder = require("portfinder");

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    /* webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    }, */
  });
  let datasette = null;
  let port = null;

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
    datasette = cp.spawn("datasette", args);
    datasette.on("error", (err) => {
      console.error("Failed to start datasette");
      app.quit();
    });
  }

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
      mainWindow.webContents.on("did-fail-load", function () {
        console.log("did-fail-load");
        setTimeout(tryAndLoad, 300);
      });

      function tryAndLoad() {
        mainWindow.loadURL(`http://localhost:${port}`);
      }
      setTimeout(tryAndLoad, 300);

      var menu = Menu.buildFromTemplate([
        {
          label: "Menu",
          submenu: [
            {
              label: "New Window",
              accelerator: "CommandOrControl+N",
              click() {
                let opts = {
                  width: 800,
                  height: 600,
                };
                if (BrowserWindow.getFocusedWindow()) {
                  const pos = BrowserWindow.getFocusedWindow().getPosition();
                  opts.x = pos[0] + 22;
                  opts.y = pos[1] + 22;
                }
                new BrowserWindow(opts).loadURL(`http://localhost:${port}`);
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
                  var windows = BrowserWindow.getAllWindows();
                  if (windows.length == 0) {
                    // Open a new window
                    new BrowserWindow({ width: 800, height: 600 }).loadURL(
                      `http://localhost:${port}`
                    );
                  } else {
                    // Reload any windows showing the / page
                    BrowserWindow.getAllWindows().forEach((win) => {
                      let url = new URL(win.webContents.getURL());
                      if (url.pathname == "/") {
                        setTimeout(() => win.webContents.reload(), 300);
                      }
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
