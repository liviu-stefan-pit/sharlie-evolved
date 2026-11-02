const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sharlie', {
  state: () => ipcRenderer.invoke('state'),
  action: (body) => ipcRenderer.invoke('action', body),
  lookup: (query) => ipcRenderer.invoke('lookup', query),
  onLearning: (callback) => {
    const handler = (_event, state) => callback(state)
    ipcRenderer.on('learning', handler)
    return () => ipcRenderer.removeListener('learning', handler)
  },
  cancelLearning: () => ipcRenderer.invoke('cancel-learning'),
})
