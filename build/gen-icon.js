// 生成 BMP 格式 icon.ico (electron-builder 兼容, biHeight = size*2)
const fs = require('fs');
const path = require('path');

function isCheckmark(x, y, size) {
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const thick = Math.max(1, size * 0.08);
  const p1 = [cx - size*0.18, cy + size*0.02];
  const p2 = [cx - size*0.04, cy + size*0.16];
  const p3 = [cx + size*0.22, cy - size*0.16];
  return distToSeg(x, y, p1, p2) <= thick || distToSeg(x, y, p2, p3) <= thick;
}

function distToSeg(px, py, a, b) {
  const dx = b[0]-a[0], dy = b[1]-a[1];
  const l2 = dx*dx + dy*dy;
  if (l2 === 0) return Math.hypot(px-a[0], py-a[1]);
  let t = ((px-a[0])*dx + (py-a[1])*dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px-(a[0]+t*dx), py-(a[1]+t*dy));
}

function makeImage(size) {
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const radius = size * 0.28;
  const headerSize = 40;
  const pixelSize = size * size * 4;
  const maskSize = Math.ceil(size / 8) * size;
  const imageSize = headerSize + pixelSize + maskSize;

  // BITMAPINFOHEADER
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // header size
  header.writeInt32LE(size, 4);         // biWidth
  header.writeInt32LE(size * 2, 8);     // biHeight (doubled for AND mask)
  header.writeUInt16LE(1, 12);          // planes
  header.writeUInt16LE(32, 14);         // bpp
  header.writeUInt32LE(0, 16);          // compression BI_RGB
  header.writeUInt32LE(pixelSize, 20);  // biSizeImage
  // rest zeros

  // 像素 BGRA (从底到顶)
  const pixels = Buffer.alloc(pixelSize);
  for (let row = 0; row < size; row++) {
    const y = size - 1 - row; // BMP 自底向上
    for (let x = 0; x < size; x++) {
      const i = (row * size + x) * 4;
      const dx = Math.max(Math.abs(x - cx) - (size/2 - radius), 0);
      const dy = Math.max(Math.abs(y - cy) - (size/2 - radius), 0);
      const dist = Math.sqrt(dx*dx + dy*dy);
      const inside = dist <= radius;
      if (!inside) {
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
      } else {
        const isCheck = isCheckmark(x, y, size);
        if (isCheck) { pixels[i]=255; pixels[i+1]=255; pixels[i+2]=255; pixels[i+3]=255; }
        else { pixels[i]=255; pixels[i+1]=122; pixels[i+2]=0; pixels[i+3]=255; } // #007AFF 蓝色 (BGRA 存储)
      }
    }
  }

  // AND mask (全 0 = 不透明)
  const mask = Buffer.alloc(maskSize);
  return { header, pixels, mask, imageSize, size };
}

function buildIco(sizes) {
  const imgs = sizes.map(makeImage);
  const dirSize = 6 + imgs.length * 16;
  let offset = dirSize;
  const entries = imgs.map(im => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(im.size === 256 ? 0 : im.size, 0);
    entry.writeUInt8(im.size === 256 ? 0 : im.size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(im.imageSize, 8);
    entry.writeUInt32LE(offset, 12);
    offset += im.imageSize;
    return entry;
  });
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);          // reserved
  dir.writeUInt16LE(1, 2);          // type (1 = icon)
  dir.writeUInt16LE(imgs.length, 4); // count
  const parts = [dir, ...entries];
  imgs.forEach(im => parts.push(im.header, im.pixels, im.mask));
  return Buffer.concat(parts);
}

const ico = buildIco([16, 32, 48, 64, 128, 256]);
const outDir = path.join(__dirname, '..', 'build');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
console.log('icon.ico generated:', ico.length, 'bytes');
