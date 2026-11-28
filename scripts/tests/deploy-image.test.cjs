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
  const ca = path.join(dir, 'ca.pem');
  const network = path.join(dir, 'network.env');
  fs.writeFileSync(ca, 'test certificate');
  fs.writeFileSync(network, 'HTTPS_PROXY=http://proxy:8080\nNO_PROXY=localhost,internal\n');
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
    NETWORK_ENV_FILE: options.network ? network : '', CA_BUNDLE_FILE: options.network ? ca : '',
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

test('fresh install injects network settings before startup and mounts trusted CA read-only', () => {
  const r = install({ network: true });
  assert.equal(r.status, 0, r.stderr);
  const run = r.calls.find(x => x[0] === 'run' && x.includes('-d'));
  assert.ok(run.includes('NODE_USE_ENV_PROXY=1'));
  assert.ok(run.includes('NODE_EXTRA_CA_CERTS=/etc/coregenie/ca-bundle.pem'));
  assert.ok(run.some(x => x.endsWith('target=/etc/coregenie/ca-bundle.pem,readonly')));
  assert.equal(run.filter(x => x === '--env-file').length, 2);
});

function runUpdate(args, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-update-test-'));
  const dockerLog = path.join(dir, 'docker.log');
  const nodeLog = path.join(dir, 'node.log');
  const curlLog = path.join(dir, 'curl.log');
  const stateDir = options.stateDir ? path.join(dir, 'state') : '';
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_DOCKER_LOG, JSON.stringify(a) + '\\n');
if (a[0] === 'ps') console.log(process.env.TEST_RUNNING_CONTAINERS || '');
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'node'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.TEST_NODE_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
`, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const a = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CURL_LOG, JSON.stringify(a) + '\\n');
const outIndex = a.indexOf('--output');
if (outIndex >= 0) fs.writeFileSync(a[outIndex + 1], '// downloaded helper\\n');
`, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: dir + ':' + process.env.PATH,
    TEST_DOCKER_LOG: dockerLog,
    TEST_NODE_LOG: nodeLog,
    TEST_CURL_LOG: curlLog,
    TEST_RUNNING_CONTAINERS: options.runningContainers || '',
    CONTAINER_NAME: options.containerName || 'anythingllm',
    STATE_DIR: stateDir,
    ALLOW_RUNNING: options.allowRunning ? '1' : '',
    TAG: '',
    IMAGE: '',
    BROKER_IMAGE: '',
  };
  try {
    const run = options.piped
      ? spawnSync('bash', ['-s', '--', ...args], { env, input: fs.readFileSync(script, 'utf8'), encoding: 'utf8' })
      : spawnSync('bash', [script, ...args], { env, encoding: 'utf8' });
    const readJsonLines = (file) =>
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return {
      status: run.status,
      stdout: run.stdout,
      stderr: run.stderr,
      nodeCalls: readJsonLines(nodeLog),
      curlCalls: readJsonLines(curlLog),
      stateDir,
    };
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
}

test('update-all latest updates app and running broker with split state dirs', () => {
  const r = runUpdate(['update-all', 'latest'], {
    runningContainers: 'anythingllm\nanythingllm-sandbox-broker\n',
    stateDir: true,
    allowRunning: true,
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.curlCalls.length, 0);
  assert.equal(r.nodeCalls.length, 2);
  assert.ok(r.nodeCalls[0].includes('ghcr.io/acore2026/coregenie:latest'));
  assert.ok(r.nodeCalls[0].includes('--allow-running'));
  assert.ok(r.nodeCalls[0].includes(path.join(r.stateDir, 'app')));
  assert.ok(r.nodeCalls[1].includes('--broker'));
  assert.ok(r.nodeCalls[1].includes('ghcr.io/acore2026/coregenie-sandbox-broker:latest'));
  assert.ok(r.nodeCalls[1].includes(path.join(r.stateDir, 'broker')));
});

test('update-all skips sandbox broker when it is not running', () => {
  const r = runUpdate(['update-all', 'latest'], { runningContainers: 'anythingllm\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.nodeCalls.length, 1);
  assert.match(r.stdout, /skipped/i);
});

test('piped execution downloads helper from matching commit for sha tags', () => {
  const sha = '1dea4aa21234567890abcdef1234567890abcdef';
  const r = runUpdate(['update-all', `sha-${sha}`], {
    piped: true,
    runningContainers: 'anythingllm\n',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.curlCalls.length, 1);
  assert.ok(r.curlCalls[0].includes(`https://raw.githubusercontent.com/acore2026/CoreGenie/${sha}/scripts/deploy-existing-container.cjs`));
  assert.equal(r.nodeCalls.length, 1);
  assert.ok(r.nodeCalls[0].includes(`ghcr.io/acore2026/coregenie:sha-${sha}`));
});

test('rejects invalid image tags before touching containers', () => {
  const r = runUpdate(['update-all', 'bad/tag']);
  assert.equal(r.status, 2);
  assert.equal(r.nodeCalls.length, 0);
});
