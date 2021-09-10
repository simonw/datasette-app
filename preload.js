const { ipcRenderer, contextBridge } = require("electron");
const path = require("path");
contextBridge.exposeInMainWorld("datasetteApp", {
  importCsv: (database) => {
    ipcRenderer.send("import-csv", database);
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
