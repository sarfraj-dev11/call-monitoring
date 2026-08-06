const { spawn, execSync } = require('child_process');
const path = require('path');
const os = require('os');

const home = os.homedir();
const cargoBin = path.join(home, '.cargo', 'bin');
const mingwBin = path.join(home, 'w64devkit', 'w64devkit', 'bin');

const env = { ...process.env };
const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
const sep = process.platform === 'win32' ? ';' : ':';
env[pathKey] = `${mingwBin}${sep}${cargoBin}${sep}${env[pathKey] || ''}`;

// Clean up any stale running app instances to avoid Windows file locks (os error 32 & os error 5)
if (process.platform === 'win32') {
  try {
    execSync('taskkill /F /IM call-monitor-ai.exe 2>nul', { stdio: 'ignore' });
    execSync('timeout /t 1 /nobreak >nul 2>&1', { stdio: 'ignore' });
  } catch (e) {}
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const waitOn = spawn(npxCmd, ['wait-on', 'http://localhost:3000', '--timeout', '2000'], { env, shell: true, stdio: 'ignore' });

waitOn.on('close', (code) => {
  let child;
  if (code === 0) {
    console.log("⚡ Attached to existing server on http://localhost:3000. Launching Tauri...");
    child = spawn(npxCmd, ['@tauri-apps/cli', 'dev'], { env, shell: true, stdio: 'inherit' });
  } else {
    console.log("⚡ Launching Next.js dev server & Tauri desktop app...");
    const cmd = `${npxCmd} concurrently "npm run dev" "${npxCmd} wait-on http://localhost:3000 && ${npxCmd} @tauri-apps/cli dev"`;
    child = spawn(cmd, [], { env, shell: true, stdio: 'inherit' });
  }
  child.on('exit', (c) => process.exit(c || 0));
});
