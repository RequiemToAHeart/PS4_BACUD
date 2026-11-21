const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDb(name) {
  const directory = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, `${name}.db`));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

module.exports = { openDb };
