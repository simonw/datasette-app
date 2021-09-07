const { ipcRenderer, contextBridge } = require("electron");
contextBridge.exposeInMainWorld("datasetteApp", {
  importCsv: (database) => {
    ipcRenderer.send("import-csv", database);
  },
});
ipcRenderer.on("csv-imported", () => {
  location.reload();
});
