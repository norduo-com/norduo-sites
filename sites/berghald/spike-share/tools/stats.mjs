import fs from 'node:fs';
const txt = fs.readFileSync(process.argv[2], 'utf8');
const objs = []; let depth = 0, start = -1, inStr = false, esc = false;
for (let i = 0; i < txt.length; i++) { const c = txt[i];
  if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
  if (c === '"') inStr = true; else if (c === '{') { if (!depth++) start = i; } else if (c === '}') { if (!--depth) objs.push(JSON.parse(txt.slice(start, i + 1))); } }
const g = {};
for (const o of objs) { const u = new URL(o.event?.request?.url ?? 'http://x/?'); let k = u.searchParams.get('v') ?? (u.pathname + (u.pathname === '/og' ? ' size=' + u.searchParams.get('size') : ''));
  (g[k] ??= []).push({ cpu: o.cpuTime, wall: o.wallTime, out: o.outcome, st: o.event?.response?.status }); }
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
for (const [k, v] of Object.entries(g)) { const c = v.map(x => x.cpu).sort((a, b) => a - b), w = v.map(x => x.wall).sort((a, b) => a - b);
  console.log(k.padEnd(14), 'n=' + v.length, 'cpu p50', pct(c, .5), 'p90', pct(c, .9), 'max', c.at(-1), '| wall p50', pct(w, .5), 'p90', pct(w, .9), '| outcomes', [...new Set(v.map(x => x.out + '/' + x.st))].join(',')); }
