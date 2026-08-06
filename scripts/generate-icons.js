const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = makeChunk('IHDR', ihdr);

  const rowSize = 1 + width * 4;
  const imgData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    imgData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      imgData[pxOffset] = 37;
      imgData[pxOffset + 1] = 99;
      imgData[pxOffset + 2] = 235;
      imgData[pxOffset + 3] = 255;
    }
  }
  const compressed = zlib.deflateSync(imgData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = crc32(body);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, body, crcBuf]);
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createIco(pngBuf, width, height) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const dir = Buffer.alloc(16);
  dir[0] = width >= 256 ? 0 : width;
  dir[1] = height >= 256 ? 0 : height;
  dir[2] = 0;
  dir[3] = 0;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(pngBuf.length, 8);
  dir.writeUInt32LE(22, 12);

  return Buffer.concat([header, dir, pngBuf]);
}

const iconsDir = path.join(__dirname, '..', 'src-tauri', 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const png32 = createPng(32, 32);
const png128 = createPng(128, 128);
const ico = createIco(png32, 32, 32);

fs.writeFileSync(path.join(iconsDir, '32x32.png'), png32);
fs.writeFileSync(path.join(iconsDir, '128x128.png'), png128);
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), png128);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), png128);
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), png128);

console.log("Generated valid Tauri icons successfully!");
