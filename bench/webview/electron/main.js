const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(process.env.BENCH_CONFIG, 'utf8'));
const driverSource = fs.readFileSync(config.driver_path, 'utf8');
let win = null;

const hostInfo = () => {
  const display = screen.getPrimaryDisplay();
  return {
    engine: 'chromium',
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    v8: process.versions.v8,
    display: {
      size: display.size,
      scale_factor: display.scaleFactor,
      frequency: display.displayFrequency,
    },
    content_bounds: win.getContentBounds(),
    focused: win.isFocused(),
    visible: win.isVisible(),
    main_pid: process.pid,
  };
};

ipcMain.on('bench-init', (event) => {
  event.returnValue = { bench: config.bench, driver: driverSource };
});

ipcMain.on('bench', async (_event, raw) => {
  const msg = JSON.parse(raw);
  if (msg.type === 'screenshot') {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(config.out_dir, 'screenshot.png'), image.toPNG());
    win.webContents.executeJavaScript('window.__benchSnapshotDone && window.__benchSnapshotDone()');
  } else if (msg.type === 'mark') {
    fs.writeFileSync(path.join(config.out_dir, `mark-${msg.name}`), '');
    const ack = path.join(config.out_dir, `ack-${msg.name}`);
    const timer = setInterval(() => {
      if (!fs.existsSync(ack)) return;
      clearInterval(timer);
      win.webContents.executeJavaScript('window.__benchMarkDone && window.__benchMarkDone()');
    }, 100);
  } else if (msg.type === 'result') {
    fs.writeFileSync(
      path.join(config.out_dir, 'result.json'),
      JSON.stringify({ ...msg.result, host_info: hostInfo() }),
    );
  }
});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: config.width,
    height: config.height,
    useContentSize: true,
    x: 40,
    y: 40,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
    },
  });
  app.focus({ steal: true });
  win.focus();
  win.loadURL(config.url);
});
