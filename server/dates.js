import path from 'node:path';

const thisYear = new Date().getFullYear();
const p2 = (n) => String(n).padStart(2, '0');

export function mk(y, m, d, h = 0, mi = 0, s = 0, minYear = 1990) {
  y = +y; m = +m; d = +d; h = +h; mi = +mi; s = +s;
  if (y < minYear || y > thisYear + 1 || h > 23 || mi > 59 || s > 59) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${p2(m)}-${p2(d)} ${p2(h)}:${p2(mi)}:${p2(s)}`;
}

export function fromExif(v) {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(String(v ?? ''));
  return m ? mk(m[1], m[2], m[3], m[4], m[5], m[6], 2000) : null;
}

export function fromName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  for (const m of base.matchAll(/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?:[_-]?(\d{2})(\d{2})(\d{2}))?(?!\d)/g)) {
    const r = mk(m[1], m[2], m[3], m[4], m[5], m[6]);
    if (r) return r;
  }
  for (const m of base.matchAll(/(?<!\d)((?:19|20)\d{2})[._-](\d{2})[._-](\d{2})(?!\d)/g)) {
    const r = mk(m[1], m[2], m[3]);
    if (r) return r;
  }
  return null;
}

export function fromFolder(relDir) {
  const segs = relDir.split(path.sep).reverse();
  for (const seg of segs) {
    let m = /(?<!\d)((?:19|20)\d{2})[._-](\d{2})[._-](\d{2})(?!\d)/.exec(seg);
    if (m) { const r = mk(m[1], m[2], m[3]); if (r) return [r, 'day']; }
    m = /(?<!\d)(\d{1,2})\.(\d{1,2})\.((?:19|20)?\d{2})(?!\d)/.exec(seg);
    if (m) {
      let y = +m[3];
      if (y < 100) y += y <= 30 ? 2000 : 1900;
      const r = mk(y, m[2], m[1]);
      if (r) return [r, 'day'];
    }
    m = /(?<!\d)((?:19|20)\d{2})\.(\d{2})(?!\d)/.exec(seg);
    if (m) { const r = mk(m[1], m[2], 1); if (r) return [r, 'month']; }
    m = /(?<!\d)((?:19|20)\d{2})(?!\d)/.exec(seg);
    if (m) { const r = mk(m[1], 1, 1); if (r) return [r, 'year']; }
  }
  return null;
}

