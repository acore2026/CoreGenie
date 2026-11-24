const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.resolve(__dirname, '../deploy-image.sh');
function install(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-install-test-'));
  const log = path.join(dir, 'calls');
  const config = path.join(dir, 'config');
  const idaas = path.join(dir, 'idaas.json');
  fs.writeFileSync(idaas, '{}');
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify(a)+'\\n');
if (a[0] === 'pull' && process.env.TEST_PULL_FAIL === '1') process.exit(1);
if (a[0] === 'container' && a[1] === 'ls') console.log(process.env.TEST_EXISTING || '');
if (a[0] === 'image') console.log('sha256:immutable');
if (a[0] === 'inspect') console.log('running healthy');
if (a[0] === 'run' && a.includes('--rm')) {
  const mount = a[a.indexOf('--mount') + 1];
  const dir = mount.match(/source=(.*),target=/)[1];
  if (!fs.existsSync(dir+'/.env')) fs.writeFileSync(dir+'/.env', 'PERSISTED=true');
}
`, { mode: 0o755 });
  const env = { ...process.env, PATH: dir + ':' + process.env.PATH, TEST_LOG: log, CONFIG_DIR: config,
    IMAGE: 'test:1.15.1', VERSION: '1.15.1', CONTAINER_NAME: 'install-test', ENV_FILE: '',
    IDAAS_CONFIG_FILE: options.oauth ? idaas : '', TEST_EXISTING: options.exists ? 'install-test' : '',
    TEST_PULL_FAIL: options.pullFails ? '1' : '' };
  try {
    const run = spawnSync('bash', [script, 'install'], { env, encoding: 'utf8' });
    return { status: run.status, stderr: run.stderr, calls: fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse),
      persisted: fs.existsSync(path.join(config, '.env')), idaas };
  } finally { fs.rmSync(dir, { recursive: true }); }
}
test('fresh install persists config and storage, pins downloaded image, mounts OAuth read-only', () => {
  const r = install({ oauth: true });
  assert.equal(r.status, 0, r.stderr); assert.equal(r.persisted, true);
  const run = r.calls.find(x => x[0] === 'run' && x.includes('-d'));
  assert.equal(run.at(-1), 'sha256:immutable');
  assert.ok(run.includes('type=volume,source=install-test-storage,target=/app/server/storage'));
  assert.ok(run.includes(`type=bind,source=${r.idaas},target=/app/idaas.json,readonly`));
  assert.ok(run.includes('COREGENIE_AUTH_MODE=idaas'));
  assert.ok(run.some(x => x.endsWith('target=/app/server/.env')));
});
test('existing installation is never replaced by install', () => {
  const r = install({ exists: true });
  assert.notEqual(r.status, 0); assert.equal(r.persisted, false);
  assert.equal(r.calls.some(x => ['pull', 'run', 'stop', 'rm'].includes(x[0])), false);
});
test('pull failure leaves configuration and containers untouched', () => {
  const r = install({ pullFails: true });
  assert.notEqual(r.status, 0); assert.equal(r.persisted, false);
  assert.equal(r.calls.some(x => ['run', 'stop', 'rm'].includes(x[0])), false);
});
