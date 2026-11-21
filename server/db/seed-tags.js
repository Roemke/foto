import fs from 'node:fs';
import mysql from 'mysql2/promise';

const lines = fs
  .readFileSync(new URL('./stichwoerter.txt', import.meta.url), 'utf8')
  .split('\n')
  .filter((l) => l.trim());

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
});

let groupId = null;
let sort = 0;
for (const line of lines) {
  const level = line.match(/^ */)[0].length / 2;
  const name = line.trim();
  if (level === 0) {
    await conn.query(
      'INSERT INTO tag_groups (name, sort) VALUES (?, ?) ON DUPLICATE KEY UPDATE sort = VALUES(sort)',
      [name, sort++],
    );
    const [rows] = await conn.query('SELECT id FROM tag_groups WHERE name = ?', [name]);
    groupId = rows[0].id;
  } else {
    await conn.query('INSERT IGNORE INTO tags (group_id, name) VALUES (?, ?)', [groupId, name]);
  }
}

const [g] = await conn.query('SELECT COUNT(*) AS n FROM tag_groups');
const [t] = await conn.query('SELECT COUNT(*) AS n FROM tags');
console.log(`Gruppen: ${g[0].n}, Tags: ${t[0].n}`);
await conn.end();
