const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sharlie', {
  state: () => ipcRenderer.invoke('state'),
  action: (body) => ipcRenderer.invoke('action', body),
  lookup: (query) => ipcRenderer.invoke('lookup', query),
  revealKey: () => ipcRenderer.invoke('reveal-key'),
})
