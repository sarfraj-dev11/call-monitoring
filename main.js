const { app, BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");

let mainWindow;
let server;

function checkServerReady(url, timeout = 10000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      http.get(url, (res) => {
        if (res.statusCode < 500) {
          clearInterval(timer);
          resolve(true);
        }
      }).on("error", () => {
        if (Date.now() - startTime > timeout) {
          clearInterval(timer);
          resolve(false);
        }
      });
    }, 500);
  });
}

async function startServer() {
  if (process.env.ELECTRON_START_URL) {
    return process.env.ELECTRON_START_URL;
  }

  const PORT = 3000;
  const isRunning = await checkServerReady(`http://localhost:${PORT}`, 1000);
  if (isRunning) {
    return `http://localhost:${PORT}`;
  }

  try {
    const next = require("next");
    const nextApp = next({ dev: false, dir: __dirname });
    const handle = nextApp.getRequestHandler();

    await nextApp.prepare();

    await new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        handle(req, res);
      });
      server.on("error", reject);
      server.listen(PORT, () => {
        console.log(`Next.js server listening on http://localhost:${PORT}`);
        resolve();
      });
    });
  } catch (err) {
    console.error("Could not start embedded Next.js server:", err);
  }

  return `http://localhost:${PORT}`;
}

// Hardware Acceleration & GPU Performance Flags for 60 FPS Smooth Canvas & Audio
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-accelerated-2d-canvas");

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Call Monitor AI",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Prevents CORS issues for local audio file streaming
      backgroundThrottling: false, // Prevents audio stuttering when app is blurred/backgrounded
    },
  });

  const startUrl = await startServer();
  await checkServerReady(startUrl, 15000);
  mainWindow.loadURL(startUrl);

  // Open external links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  // Enable right-click context menu for Inspect Element & Reload
  mainWindow.webContents.on("context-menu", (e, props) => {
    const { Menu, MenuItem } = require("electron");
    const menu = new Menu();
    menu.append(
      new MenuItem({
        label: "Inspect Element",
        click: () => {
          mainWindow.webContents.inspectElement(props.x, props.y);
        },
      })
    );
    menu.append(
      new MenuItem({
        label: "Toggle DevTools (Ctrl+Shift+I / F12)",
        click: () => {
          mainWindow.webContents.toggleDevTools();
        },
      })
    );
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(
      new MenuItem({
        label: "Clear Cookies & Cache",
        click: async () => {
          await mainWindow.webContents.session.clearStorageData();
          mainWindow.reload();
        },
      })
    );
    menu.append(
      new MenuItem({
        label: "Reload Page (Ctrl+R / F5)",
        click: () => {
          mainWindow.reload();
        },
      })
    );
    menu.popup({ window: mainWindow });
  });

  // Enable keyboard shortcuts: F12 or Ctrl+Shift+I for DevTools, F5 or Ctrl+R for Refresh
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown") {
      if (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i")) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
      if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
        mainWindow.reload();
        event.preventDefault();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
  if (server) {
    try {
      server.close();
    } catch (e) {}
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

