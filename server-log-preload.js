const { ipcRenderer, contextBridge } = require("electron");

contextBridge.exposeInMainWorld("onLog", (callback) => {
  ipcRenderer.on("log", callback);
});
