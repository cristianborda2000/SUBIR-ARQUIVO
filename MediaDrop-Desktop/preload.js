const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mediaDrop", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  openFolder: () => ipcRenderer.invoke("folder:open"),
  openConfigFolder: () => ipcRenderer.invoke("config:openFolder"),
  loadState: () => ipcRenderer.invoke("state:load"),
  downloadYoutube: (id) => ipcRenderer.invoke("youtube:download", id),
  downloadYoutubeItem: (item) => ipcRenderer.invoke("youtube:downloadItem", item),
  downloadAllYoutube: () => ipcRenderer.invoke("youtube:downloadAll"),
  deleteYoutube: (id) => ipcRenderer.invoke("youtube:delete", id),
  deleteYoutubeItem: (item) => ipcRenderer.invoke("youtube:deleteItem", item),
  downloadFile: (file) => ipcRenderer.invoke("file:download", file),
  downloadCategory: (category) => ipcRenderer.invoke("category:download", category),
  downloadAllFiles: () => ipcRenderer.invoke("files:downloadAll"),
  deleteFile: (id) => ipcRenderer.invoke("file:delete", id),
  openAdminWeb: () => ipcRenderer.invoke("admin:openWeb")
});
