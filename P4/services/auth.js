const crypto = require('node:crypto');
const { openDb } = require('../shared/db');
const { users } = require('../shared/seed');
const { grpc, rpcError, serve } = require('../shared/grpc');
const { sign, handle } = require('../shared/auth');

const db = openDb('auth');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )
`);

for (const user of users) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(user.password, salt, 64).toString('hex');
  db.prepare(`
    INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      salt = excluded.salt,
      password_hash = excluded.password_hash
  `)
    .run(user.id, user.username, user.name, user.role, salt, hash);
}

serve('AuthService', {
  login(call, callback) {
    handle(callback, () => {
      const username = String(call.request.username || '').trim().toLowerCase();
      const password = String(call.request.password || '');
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      const salt = user?.salt || '00000000000000000000000000000000';
      const expected = Buffer.from(user?.password_hash || '00'.repeat(64), 'hex');
      const candidate = crypto.scryptSync(password, salt, 64);
      if (!user || !crypto.timingSafeEqual(expected, candidate)) {
        throw rpcError(grpc.status.UNAUTHENTICATED, 'Invalid username or password.');
      }
      return { token: sign(user), userId: user.id, name: user.name, role: user.role };
    });
  }
}, Number(process.env.AUTH_PORT || 50051));
