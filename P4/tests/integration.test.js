const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { client, call, grpc } = require('../shared/grpc');

const root = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForPort(port, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Service exited with code ${child.exitCode}`);
    try {
      await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', reject);
      });
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 75));
    }
  }
  throw new Error(`Service on port ${port} did not start`);
}

async function fetchPage(base, route, options = {}, cookie = '') {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${base}${route}`, { ...options, headers, redirect: 'manual' });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

async function login(base, username, password = 'hotdog1') {
  const response = await fetchPage(base, '/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password })
  });
  return { ...response, cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
}

test('independent MVC and gRPC nodes', { timeout: 30000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enrollflow-test-'));
  const portNames = ['AUTH', 'CATALOG', 'ENROLLMENT', 'GRADES', 'WEB'];
  const ports = await Promise.all(portNames.map(() => freePort()));
  const env = {
    ...process.env,
    DATA_DIR: directory,
    JWT_SECRET: 'integration-test-shared-secret-that-is-very-long'
  };
  portNames.forEach((name, index) => {
    env[`${name}_PORT`] = String(ports[index]);
    if (name !== 'WEB') env[`${name}_ADDRESS`] = `127.0.0.1:${ports[index]}`;
  });
  const files = ['services/auth.js', 'services/catalog.js', 'services/enrollment.js', 'services/grades.js', 'web/app.js'];
  const processes = files.map(file => spawn(process.execPath, [path.join(root, file)], {
    cwd: root,
    env,
    stdio: 'ignore'
  }));
  t.after(() => {
    processes.forEach(child => { if (child.exitCode === null) child.kill(); });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await Promise.all(processes.map((child, index) => waitForPort(ports[index], child)));

  const base = `http://127.0.0.1:${ports[4]}`;
  const alice = await login(base, 'student1');
  assert.equal(alice.status, 302);
  assert.ok(alice.cookie.startsWith('enrollment_token='));
  const bad = await login(base, 'student1', 'incorrect');
  assert.equal(bad.status, 302);
  assert.ok(bad.headers.get('location').includes('error='));

  const dashboard = await fetchPage(base, '/dashboard', {}, alice.cookie);
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.body, /Alice Dela Cruz/);
  const coursePage = await fetchPage(base, '/courses', {}, alice.cookie);
  assert.match(coursePage.body, /Computer Networks/);

  const enroll = await fetchPage(base, '/enrollments', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: 'STDISM' })
  }, alice.cookie);
  assert.match(enroll.headers.get('location'), /Successfully/);
  const repeat = await fetchPage(base, '/enrollments', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: 'STDISM' })
  }, alice.cookie);
  assert.match(repeat.headers.get('location'), /already/);
  const mine = await fetchPage(base, '/enrollments', {}, alice.cookie);
  assert.match(mine.body, /Currently enrolled/);

  const bob = await login(base, 'student2');
  const charlie = await login(base, 'student3');
  const enrollmentClient = client('EnrollmentService', env.ENROLLMENT_ADDRESS);
  const enrollmentTokens = [alice.cookie, bob.cookie, charlie.cookie].map(cookie => cookie.split('=')[1]);
  const seatResults = await Promise.allSettled(enrollmentTokens.map(token => call(enrollmentClient, 'enroll', {
    code: 'CSALGCM'
  }, token)));
  assert.equal(seatResults.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(seatResults.filter(result => result.status === 'rejected' && result.reason.code === grpc.status.RESOURCE_EXHAUSTED).length, 1);

  const gradeClient = client('GradeService', env.GRADES_ADDRESS);
  const token = alice.cookie.split('=')[1];
  await assert.rejects(() => call(gradeClient, 'uploadGrade', {
    studentId: '2026-001', courseCode: 'STDISM', term: 'AY 2026-2027 T1', grade: 99
  }, token), error => error.code === grpc.status.PERMISSION_DENIED);

  const faculty = await login(base, 'prof1');
  assert.ok(faculty.cookie);
  const upload = await fetchPage(base, '/faculty', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ studentId: '2026-001', courseCode: 'STDISM', term: 'AY 2026-2027 T1', grade: '98' })
  }, faculty.cookie);
  assert.match(upload.headers.get('location'), /Grade%20saved/);
  const gradePage = await fetchPage(base, '/grades', {}, alice.cookie);
  assert.match(gradePage.body, /98/);

  processes[3].kill();
  await new Promise(resolve => processes[3].once('exit', resolve));
  const gradeOutage = await fetchPage(base, '/grades', {}, alice.cookie);
  assert.match(gradeOutage.body, /service is currently offline/i);
  const catalogSurvives = await fetchPage(base, '/courses', {}, alice.cookie);
  assert.match(catalogSurvives.body, /Computer Networks/);
  const enrollmentSurvives = await fetchPage(base, '/enrollments', {}, alice.cookie);
  assert.match(enrollmentSurvives.body, /My enrollments/);

  processes[0].kill();
  await new Promise(resolve => processes[0].once('exit', resolve));
  const signedInStillWorks = await fetchPage(base, '/courses', {}, alice.cookie);
  assert.match(signedInStillWorks.body, /Computer Networks/);
  const loginOutage = await login(base, 'student3');
  assert.ok(loginOutage.headers.get('location').includes('error='));
});

test('updates demo credentials in an existing database', { timeout: 10000 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'enrollflow-migration-'));
  const db = new DatabaseSync(path.join(directory, 'auth.db'));
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync('demo123', salt, 64).toString('hex');
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)')
    .run('2026-001', 'alice', 'Alice Dela Cruz', 'student', salt, hash);
  db.close();

  const port = await freePort();
  const processHandle = spawn(process.execPath, [path.join(root, 'services/auth.js')], {
    cwd: root,
    env: { ...process.env, DATA_DIR: directory, AUTH_PORT: String(port), JWT_SECRET: 'migration-test-long-secret' },
    stdio: 'ignore'
  });
  t.after(() => {
    if (processHandle.exitCode === null) processHandle.kill();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await waitForPort(port, processHandle);

  const authClient = client('AuthService', `127.0.0.1:${port}`);
  const current = await call(authClient, 'login', { username: 'student1', password: 'hotdog1' });
  assert.equal(current.userId, '2026-001');
  await assert.rejects(() => call(authClient, 'login', {
    username: 'alice', password: 'demo123'
  }), error => error.code === grpc.status.UNAUTHENTICATED);
});
