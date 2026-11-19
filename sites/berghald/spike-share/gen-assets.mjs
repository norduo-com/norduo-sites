import opentype from 'opentype.js';
import fs from 'node:fs';
import zlib from 'node:zlib';
const A = process.argv[2];
// glyph table per char, in em: [advance, xMin, yMin, yMax]
const font = (b=>opentype.parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)))(fs.readFileSync(`${A}/outfit-700.woff`));
const chars = [];
for (let c = 0x20; c <= 0xff; c++) if (c < 0x7f || c >= 0xa0) chars.push(String.fromCharCode(c));
chars.push('–','—','’','“','”','„','…');
const widths = {};
for (const ch of chars) { const g = font.charToGlyph(ch); const b = g.getBoundingBox(), u = font.unitsPerEm, r = (v) => +(v / u).toFixed(4); widths[ch] = [r(g.advanceWidth), r(b.x1), r(b.y1), r(b.y2)]; }
fs.writeFileSync(process.argv[3], JSON.stringify({ unitsPerEm: font.unitsPerEm, ascender: font.ascender/font.unitsPerEm, descender: font.descender/font.unitsPerEm, widths }));
// PNG writer
function png(w, h, px) { // px(x,y) -> [r,g,b,a]
  const raw = Buffer.alloc((w*4+1)*h);
  for (let y=0;y<h;y++){ raw[y*(w*4+1)]=0; for(let x=0;x<w;x++){ const p=px(x,y); raw.set(p, y*(w*4+1)+1+x*4);} }
  const crc = (b)=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let r=0xffffffff;for(const x of b)r=t[(r^x)&255]^(r>>>8);return (r^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
// gradient 1200x630: transparent top -> 80% dark green-black bottom
fs.writeFileSync(`${A}/gradient.png`, png(1200,630,(x,y)=>{const t=Math.max(0,(y/630-0.25)/0.75);return [10,20,15,Math.round(235*t*t*(3-2*t))];}));
// synthetic "landscape" cover 1600x1067 as opaque PNG (to be converted to JPEG with sips)
let s=1; const rnd=()=>(s=(s*16807)%2147483647)/2147483647;
fs.writeFileSync(`${A}/cover.png`, png(1600,1067,(x,y)=>{const sky=y<420+60*Math.sin(x/170); const n=rnd()*40;
  return sky?[120+y/8+n/3|0,160+y/10+n/3|0,210+n/4|0,255]:[50+n+20*Math.sin(x/30)|0,95+n+15*Math.sin(y/23)|0,45+n/2|0,255];}));
