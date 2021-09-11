const { ipcRenderer, contextBridge } = require("electron");
const path = require("path");
contextBridge.exposeInMainWorld("datasetteApp", {
  importCsv: (database) => {
    ipcRenderer.send("import-csv", database);
  },
  installPlugin: (plugin, link) => {
    ipcRenderer.send("install-plugin", plugin);
    if (link) {
      link.style.opacity = 0.5;
      link.setAttribute("href", "#");
      link.innerHTML = `Installing ${plugin}…`;
    }
  },
  onServerLog: (callback) => {
    ipcRenderer.on("serverLog", callback);
  },
  onProcessLog: (callback) => {
    ipcRenderer.on("processLog", callback);
  },
  venvPath: path.join(process.env.HOME, ".datasette-app", "venv")
});
ipcRenderer.on("csv-imported", () => {
  location.reload();
});
ipcRenderer.on("plugin-installed", () => {
  location.reload();
});
