const fs = require('fs');
const path = require('path');

// icns "PNG-in-icns" chunk types, keyed by the pixel size of the PNG they carry.
const typeForSize = {
  16: 'icp4',
  32: 'icp5',
  64: 'icp6',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10',
};

const sizes = [16, 32, 64, 128, 256, 512, 1024];
const chunks = [];

for (const s of sizes) {
  const png = fs.readFileSync(path.join(__dirname, `icon-${s}.png`));
  const type = Buffer.from(typeForSize[s], 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(8 + png.length, 0); // chunk header (8) + data
  chunks.push(Buffer.concat([type, len, png]));
}

const body = Buffer.concat(chunks);
const totalLen = 8 + body.length; // "icns" + total length field + body

const header = Buffer.alloc(8);
header.write('icns', 0, 'ascii');
header.writeUInt32BE(totalLen, 4);

const icns = Buffer.concat([header, body]);
fs.writeFileSync(path.join(__dirname, 'icon.icns'), icns);
console.log('wrote icon.icns', icns.length, 'bytes');
