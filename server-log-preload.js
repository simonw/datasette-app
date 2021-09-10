const { ipcRenderer, contextBridge } = require("electron");

contextBridge.exposeInMainWorld("onServerLog", (callback) => {
  ipcRenderer.on("serverLog", callback);
});
