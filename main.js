const { app, Menu, BrowserWindow, dialog } = require("electron");
const path = require("path");
const cp = require("child_process");

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    /* webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    }, */
  });
  // Start Python Datasette process
  let datasette = cp.spawn('datasette', ['--memory', '--port', '8024']);
  datasette.on('error', (err) => {
    console.error('Failed to start datasette');
    app.quit();
  });

  mainWindow.webContents.on("did-fail-load", function() {
    console.log("did-fail-load");
    setTimeout(tryAndLoad, 300);
  });

  function tryAndLoad() {
    mainWindow.loadURL('http://localhost:8024');
  };
  setTimeout(tryAndLoad, 300);
  
  var menu = Menu.buildFromTemplate([
    {
      label: "Menu",
      submenu: [
        {
          label: "About Datasette",
          click() {
            dialog.showMessageBox({
              type: "info",
              title: "Datasette",
              message: cp.execSync("datasette --version").toString()
            });
          },
        },
        {
          label: "Quit",
          click() {
            app.quit();
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

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
