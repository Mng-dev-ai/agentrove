const { ipcRenderer } = require('electron');

const init = ipcRenderer.sendSync('bench-init');
window.__BENCH__ = init.bench;
window.benchHost = { post: (raw) => ipcRenderer.send('bench', raw) };
new Function(init.driver)();
