const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('sportsDesktop', {
  engine: () => ipcRenderer.invoke('engine:state'),
  publish: frame => ipcRenderer.send('engine:publish', frame),
  onEngineCommand: listener => { ipcRenderer.on('engine:command', (_event, command) => listener(command)); },
  onFrame: listener => { ipcRenderer.on('desktop:frame', (_event, frame) => listener(frame)); },
  onBrowseFeedback: listener => { ipcRenderer.on('desktop:browse-feedback', (_event, message) => listener(message)); },
  status: () => ipcRenderer.invoke('desktop:status'),
  onFullscreenChange: listener => { ipcRenderer.on('desktop:fullscreen', (_event, value) => listener(value)); },
  action: (action, value) => ipcRenderer.invoke('desktop:action', action, value),
});
