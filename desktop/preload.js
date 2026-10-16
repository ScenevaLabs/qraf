const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qraf', {
  listDisks: () => ipcRenderer.invoke('disks:list'),
  scanDisk: (mountpoint) => ipcRenderer.invoke('disks:scan', mountpoint),
  speedTestDisk: (mountpoint) => ipcRenderer.invoke('disks:speedTest', mountpoint),
  isDiskBusy: (device) => ipcRenderer.invoke('disks:isBusy', device),
  onDisksChanged: (callback) => {
    const listener = (_event, disks) => callback(disks);
    ipcRenderer.on('disks:changed', listener);
    return () => ipcRenderer.removeListener('disks:changed', listener);
  },
  exportPdf: (html) => ipcRenderer.invoke('pdf:export', html),
});
