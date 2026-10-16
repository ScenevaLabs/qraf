const fs = require('fs');
const path = require('path');

const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => fs.readFileSync(path.join(__dirname, `icon-${s}.png`)));

const headerSize = 6;
const entrySize = 16;
let offset = headerSize + entrySize * sizes.length;

const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4); // image count

const entries = [];
for (let i = 0; i < sizes.length; i++) {
  const s = sizes[i];
  const png = pngs[i];
  const entry = Buffer.alloc(entrySize);
  entry.writeUInt8(s === 256 ? 0 : s, 0); // width (0 = 256)
  entry.writeUInt8(s === 256 ? 0 : s, 1); // height
  entry.writeUInt8(0, 2); // color palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8); // size of image data
  entry.writeUInt32LE(offset, 12); // offset of image data
  offset += png.length;
  entries.push(entry);
}

const ico = Buffer.concat([header, ...entries, ...pngs]);
fs.writeFileSync(path.join(__dirname, '..', 'build-assets', 'icon.ico'), ico);
console.log('wrote icon.ico', ico.length, 'bytes');
