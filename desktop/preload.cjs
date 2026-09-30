const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sportsDesktop', {
  engine: () => ipcRenderer.invoke('engine:state'),
  publish: frame => ipcRenderer.send('engine:publish', frame),
  onEngineCommand: listener => { ipcRenderer.on('engine:command', (_event, command) => listener(command)); },
  status: () => ipcRenderer.invoke('desktop:status'),
  action: (action, value) => ipcRenderer.invoke('desktop:action', action, value),
});
