const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const home = os.homedir();
const cargoBin = path.join(home, '.cargo', 'bin');
const mingwBin = path.join(home, 'w64devkit', 'w64devkit', 'bin');

const env = { ...process.env };
const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') || 'PATH';
const sep = process.platform === 'win32' ? ';' : ':';
env[pathKey] = `${mingwBin}${sep}${cargoBin}${sep}${env[pathKey] || ''}`;

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

console.log("📦 Building Next.js & compiling standalone Tauri desktop .exe...");
const child = spawn(`${npxCmd} next build && ${npxCmd} @tauri-apps/cli build`, [], { env, shell: true, stdio: 'inherit' });
child.on('exit', (c) => process.exit(c || 0));
