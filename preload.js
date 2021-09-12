const { ipcRenderer, contextBridge } = require("electron");
const path = require("path");
contextBridge.exposeInMainWorld("datasetteApp", {
  importCsv: (database) => {
    ipcRenderer.send("import-csv", database);
  },
  importCsvFromUrl: (url, link) => {
    var tableName = link ? link.dataset.tablename : "";
    ipcRenderer.send("import-csv-from-url", { url, tableName });
    if (link) {
      link.style.opacity = 0.5;
      link.innerHTML = `Importing ${link.dataset.name}…`;
    }
  },
  installPlugin: (plugin, link) => {
    ipcRenderer.send("install-plugin", plugin);
    if (link) {
      link.style.opacity = 0.5;
      link.setAttribute("href", "#");
      link.innerHTML = `Installing ${plugin}…`;
    }
  },
  uninstallPlugin: (plugin, link) => {
    ipcRenderer.send("uninstall-plugin", plugin);
    if (link) {
      link.style.opacity = 0.5;
      link.setAttribute("href", "#");
      link.innerHTML = `Uninstalling ${plugin}…`;
    }
  },
  onServerLog: (callback) => {
    ipcRenderer.on("serverLog", callback);
  },
  onProcessLog: (callback) => {
    ipcRenderer.on("processLog", callback);
  },
  venvPath: path.join(process.env.HOME, ".datasette-app", "venv"),
});
ipcRenderer.on("csv-imported", () => {
  location.reload();
});
ipcRenderer.on("plugin-installed", () => {
  location.reload();
});
ipcRenderer.on("plugin-uninstalled", () => {
  location.reload();
});
