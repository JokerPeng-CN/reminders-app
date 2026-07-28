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

function makeTrayPNG(size, count) {
  const cx = (size - 1) / 2, cy = (size - 1) / 2;
  const radius = size * 0.46;
  const innerRadius = size * 0.38;

  const rowLen = size * 4;
  const raw = Buffer.alloc((1 + rowLen) * size);

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + rowLen);
    raw[rowStart] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const i = rowStart + 1 + x * 4;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (dist > radius) {
        // 透明
        raw[i] = 0; raw[i+1] = 0; raw[i+2] = 0; raw[i+3] = 0;
      } else {
        // 蓝色底 #007AFF
        let r = 0, g = 122, b = 255, a = 255;
        // 边缘抗锯齿
        if (dist > radius - 1) {
          a = Math.round(255 * (radius - dist));
        }
        // 如果有数字,绘制白色数字
        if (count > 0) {
          const str = count > 99 ? '99' : String(count);
          const dw = 5, dh = 7;
          const totalW = str.length * (dw + 1) - 1;
          const scaleX = Math.max(1, Math.floor(size / 16));
          const scaleY = scaleX;
          const startX = Math.round(cx - (totalW * scaleX) / 2);
          const startY = Math.round(cy - (dh * scaleY) / 2);
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
        raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = a;
      }
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
