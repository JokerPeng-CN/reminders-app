const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// 简单 5x7 点阵数字
const DIGITS = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['01110','10001','00001','00110','00001','10001','01110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100']
};

// 问题2: 绘制对勾路径上的像素 (简化版 checkmark)
function isCheckmark(x, y, size) {
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const thick = Math.max(1, size * 0.08);
  // 对勾三点: 左下 → 中下 → 右上
  const p1 = [cx - size * 0.18, cy + size * 0.02];
  const p2 = [cx - size * 0.04, cy + size * 0.16];
  const p3 = [cx + size * 0.22, cy - size * 0.16];
  return distToSeg(x, y, p1, p2) <= thick || distToSeg(x, y, p2, p3) <= thick;
}

function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function makeTrayPNG(size, count) {
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const radius = size * 0.46;

  // 问题2: 徽标圆 (右下角)
  const badgeR = size * 0.20;
  const badgeCX = size * 0.72;
  const badgeCY = size * 0.72;

  const rowLen = size * 4;
  const raw = Buffer.alloc((1 + rowLen) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + rowLen);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      let r = 0, g = 0, b = 0, a = 0;

      if (dist <= radius) {
        // 蓝色底 #007AFF
        r = 0; g = 122; b = 255; a = 255;
        // 边缘抗锯齿
        if (dist > radius - 1) {
          a = Math.round(255 * (radius - dist));
        }
        // 白色对勾
        if (isCheckmark(x, y, size)) {
          r = 255; g = 255; b = 255; a = 255;
        }
      }

      // 问题2: 右下角徽标 (红色圆 + 白色数字)
      if (count > 0) {
        const bdist = Math.sqrt((x - badgeCX) ** 2 + (y - badgeCY) ** 2);
        if (bdist <= badgeR) {
          r = 255; g = 59; b = 48; a = 255; // 红色 #FF3B30
          // 边缘抗锯齿
          if (bdist > badgeR - 1) {
            a = Math.round(255 * (badgeR - bdist));
          }
          // 白色数字
          const str = count > 99 ? '99' : String(count);
          const dw = 5, dh = 7;
          const totalW = str.length * (dw + 1) - 1;
          const scaleX = Math.max(1, Math.floor(size / 24));
          const scaleY = scaleX;
          const startX = Math.round(badgeCX - (totalW * scaleX) / 2);
          const startY = Math.round(badgeCY - (dh * scaleY) / 2);
          for (let si = 0; si < str.length; si++) {
            const glyph = DIGITS[str[si]];
            if (!glyph) continue;
            const gx = startX + si * (dw + 1) * scaleX;
            for (let gy = 0; gy < dh; gy++) {
              for (let gxIdx = 0; gxIdx < dw; gxIdx++) {
                if (glyph[gy][gxIdx] === '1') {
                  for (let sy = 0; sy < scaleY; sy++) {
                    for (let sx = 0; sx < scaleX; sx++) {
                      const px = gx + gxIdx * scaleX + sx;
                      const py = startY + gy * scaleY + sy;
                      if (px === x && py === y) { r = 255; g = 255; b = 255; }
                    }
                  }
                }
              }
            }
          }
        }
      }

      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

module.exports = { makeTrayPNG };
