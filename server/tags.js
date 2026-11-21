const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const GROUP_ALIAS = { events: 'event', orte: 'ort', veoffentlicht: 'veroffentlicht', gebaudeaussen: 'gebaude' };

export async function loadTagCache(conn) {
  const cache = { groups: new Map(), tags: new Map(), nextSort: 1000 };
  const [gs] = await conn.query('SELECT id, name FROM tag_groups');
  for (const g of gs) cache.groups.set(norm(g.name), g.id);
  const [ts] = await conn.query('SELECT id, group_id, name FROM tags');
  for (const t of ts) cache.tags.set(`${t.group_id}:${norm(t.name)}`, t.id);
  return cache;
}

async function groupId(conn, cache, name) {
  let key = norm(name);
  key = GROUP_ALIAS[key] ?? key;
  if (!cache.groups.has(key)) {
    const [r] = await conn.query('INSERT INTO tag_groups (name, sort) VALUES (?, ?)', [
      name,
      cache.nextSort++,
    ]);
    cache.groups.set(key, r.insertId);
  }
  return cache.groups.get(key);
}

async function tagId(conn, cache, gid, name) {
  const key = `${gid}:${norm(name)}`;
  if (!cache.tags.has(key)) {
    try {
      const [r] = await conn.query('INSERT INTO tags (group_id, name, legacy) VALUES (?, ?, 1)', [gid, name]);
      cache.tags.set(key, r.insertId);
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY') throw e;
      const [rows] = await conn.query('SELECT id FROM tags WHERE group_id = ? AND name = ?', [gid, name]);
      cache.tags.set(key, rows[0].id);
    }
  }
  return cache.tags.get(key);
}

export function parseKeywords(hier, flat) {
  const out = [];
  const seen = new Set();
  for (const h of hier) {
    const parts = String(h).split('|').map((s) => s.trim()).filter(Boolean);
    parts.forEach((p) => seen.add(norm(p)));
    if (parts.length < 2) continue;
    if (norm(parts[0]) === 'bkrheinbacharchiv') {
      const rest = parts.slice(1);
      if (norm(rest[0]) === 'foto') rest.shift();
      if (rest.length) out.push({ group: 'Alt', tag: rest.join(' / ') });
    } else {
      out.push({ group: parts[0], tag: parts[parts.length - 1] });
    }
  }
  for (const f of flat) {
    const k = norm(f);
    if (!k || seen.has(k)) continue;
    out.push({ group: 'Sonstige', tag: String(f).trim() });
  }
  return out;
}

export async function linkTags(conn, cache, photoId, entries) {
  const done = new Set();
  for (const e of entries) {
    if (!e.tag) continue;
    const gid = await groupId(conn, cache, e.group);
    const tid = await tagId(conn, cache, gid, e.tag);
    if (done.has(tid)) continue;
    done.add(tid);
    await conn.query('INSERT IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)', [photoId, tid]);
  }
}
