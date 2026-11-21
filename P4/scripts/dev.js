const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const services = [
  ['auth', 'services/auth.js'],
  ['catalog', 'services/catalog.js'],
  ['enrollment', 'services/enrollment.js'],
  ['grades', 'services/grades.js'],
  ['web', 'web/app.js']
];

const children = services.map(([name, file]) => {
  const child = spawn(process.execPath, [path.join(root, file)], {
    cwd: root,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe']
  });
  child.stdout.on('data', data => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${name}] ${data}`));
  child.on('exit', code => process.stdout.write(`[${name}] stopped (${code})\n`));
  return child;
});

function stop() {
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
