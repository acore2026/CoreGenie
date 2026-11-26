const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../deploy-existing-container.cjs'), 'utf8');

async function deploy(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
  const calls = [], messages = [];
  let body, checks = 0, swapped = false;
  const old = {
    Id: 'a'.repeat(64), State: { Running: true },
    Config: { Env: ['COREGENIE_AUTH_MODE=idaas', 'COREGENIE_IDAAS_CONFIG_FILE=/secret.json', 'HTTPS_PROXY=http://proxy:8080', 'DEPLOYMENT_VERSION=1.15.0'], Cmd: ['app'], Healthcheck: { Test: ['CMD', 'health'] } },
    HostConfig: { Binds: ['/data:/app/server/storage', '/secret.json:/secret.json:ro'], PortBindings: { '3001/tcp': [{ HostPort: '7555' }] }, RestartPolicy: { Name: 'unless-stopped' } },
    NetworkSettings: { Networks: { app: { Aliases: ['anythingllm', 'a'.repeat(64), 'a'.repeat(12)] } } },
  };
  const processMock = { argv: ['node', 'helper', '--image', 'test:1.15.1', '--state-dir', directory, '--pull'], env: {}, exitCode: 0 };
  if (options.network) {
    const file = path.join(directory, "network.env");
    fs.writeFileSync(file, options.network);
    processMock.argv.push("--network-env-file", file);
  }
  if (options.ca) processMock.argv.push("--ca-bundle", options.ca);
  if (options.broker) processMock.argv.push("--broker", "--app-container", "main-app");
  if (options.broker) old.Config.Cmd = ["--socket", "/broker/run.sock", "--image", "existing-runner"];
  const docker = (_, args) => {
    calls.push(args);
    if (args[0] === 'context') return 'unix:///var/run/docker.sock';
    if (args[0] === 'pull' && options.pullFails) throw Error('pull failed');
    if (args[0] === 'image') return JSON.stringify([{ Id: 'sha256:immutable', Config: { Env: ['DEPLOYMENT_VERSION=1.15.1'] } }]);
    if (args[0] === 'inspect') return JSON.stringify([swapped ? { State: { Running: !options.unhealthy, Health: { Status: 'healthy' } } } : old]);
    if (args[0] === 'ps') return options.activeRunner ? "runner-id" : "";
    if (args[0] === 'exec' && args[2] === 'python3') {
      if (options.socketFails) throw Error("socket unavailable");
      return "";
    }
    if (args[0] === 'exec') return `ACTIVE=${++checks === options.busyCheck ? 1 : 0}`;
    if (args[0] === 'rename' && args[1].includes('-candidate-')) swapped = true;
    return '';
  };
  const http = { request: (_, callback) => {
    const request = new EventEmitter();
    request.end = (json) => {
      body = JSON.parse(json);
      const response = new EventEmitter(); response.statusCode = 201;
      callback(response); response.emit('data', '{"Id":"new"}'); response.emit('end');
    };
    return request;
  } };
  try {
    await vm.runInNewContext(source, {
      require: name => name === 'node:child_process' ? { execFileSync: docker } : name === 'node:http' ? http : require(name),
      process: processMock, setTimeout: callback => callback(),
      console: { log: value => messages.push(value), error: value => messages.push(value) },
    });
    return { calls, body, old, messages, code: processMock.exitCode,
      metadata: fs.existsSync(path.join(directory, 'deployment.json')) };
  } finally { fs.rmSync(directory, { recursive: true }); }
}

test('update preserves OAuth, storage, proxy, ports and network aliases; pins image ID', async () => {
  const r = await deploy();
  assert.equal(r.code, 0); assert.equal(r.metadata, true);
  assert.deepEqual(r.body.HostConfig, r.old.HostConfig);
  assert.deepEqual(r.body.Env.filter(x => !x.startsWith('DEPLOYMENT_VERSION=')), r.old.Config.Env.filter(x => !x.startsWith('DEPLOYMENT_VERSION=')));
  assert.ok(r.body.Env.includes('DEPLOYMENT_VERSION=1.15.1'));
  assert.equal(r.body.Image, 'sha256:immutable');
  assert.deepEqual(r.body.NetworkingConfig.EndpointsConfig.app.Aliases, ['anythingllm']);
  assert.ok(r.calls.findIndex(x => x[0] === 'pull') < r.calls.findIndex(x => x[0] === 'stop'));
  assert.equal(r.calls.some(x => x[0] === 'rm'), false);
});
test('pull failure never stops existing container', async () => {
  const r = await deploy({ pullFails: true });
  assert.equal(r.code, 1); assert.equal(r.body, undefined);
  assert.equal(r.calls.some(x => x[0] === 'stop'), false);
});
test('active Agent task prevents candidate creation', async () => {
  const r = await deploy({ busyCheck: 1 });
  assert.equal(r.code, 1); assert.equal(r.body, undefined);
  assert.equal(r.calls.some(x => x[0] === 'stop'), false);
});
test('task starting during preparation removes candidate and keeps original running', async () => {
  const r = await deploy({ busyCheck: 2 });
  assert.equal(r.code, 1); assert.ok(r.body);
  assert.equal(r.calls.some(x => x[0] === 'stop'), false);
  assert.ok(r.calls.some(x => x[0] === 'rm' && x[1].includes('-candidate-')));
});
test('failed candidate restores and starts previous container', async () => {
  const r = await deploy({ unhealthy: true });
  assert.equal(r.code, 1); assert.equal(r.metadata, false);
  assert.ok(r.calls.some(x => x[0] === 'rename' && x[1].includes('-before-') && x[2] === 'anythingllm'));
  assert.deepEqual(Array.from(r.calls.at(-1)), ['start', 'anythingllm']);
});

test('network profile is injected before Node startup and CA is mounted read-only', async () => {
  const ca = '/etc/ssl/certs/ca-certificates.crt';
  const r = await deploy({ network: 'HTTPS_PROXY=http://proxy:8080\nNO_PROXY=localhost,internal\n', ca });
  assert.equal(r.code, 0, r.messages.join('\n'));
  assert.ok(r.body.Env.includes('NODE_USE_ENV_PROXY=1'));
  assert.ok(r.body.Env.includes('NODE_EXTRA_CA_CERTS=/etc/coregenie/ca-bundle.pem'));
  assert.ok(r.body.Env.includes('NO_PROXY=localhost,internal'));
  assert.equal(r.body.HostConfig.Mounts.at(-1).ReadOnly, true);
  assert.equal(r.body.HostConfig.Mounts.at(-1).Source, fs.realpathSync(ca));
  assert.ok(r.body.HostConfig.Binds.includes('/data:/app/server/storage'));
});
test('invalid network settings fail before touching the running container', async () => {
  const r = await deploy({ network: 'NODE_TLS_REJECT_UNAUTHORIZED=0\n' });
  assert.equal(r.code, 1);
  assert.equal(r.calls.length, 0);
});
test('broker update preserves runner image and verifies its socket, with the same CA on runners', async () => {
  const r = await deploy({ broker: true, network: 'HTTPS_PROXY=http://proxy:8080\nNO_PROXY=localhost,internal', ca: '/etc/ssl/certs/ca-certificates.crt' });
  assert.equal(r.code, 0, r.messages.join('\n'));
  assert.ok(r.body.Cmd.includes('existing-runner'));
  assert.ok(r.body.Cmd.includes('--docker-ca-bundle'));
  assert.ok(r.body.Cmd.includes('--no-proxy'));
  assert.ok(r.calls.some(x => x[0] === 'exec' && x[1] === 'main-app' && x[2] === 'node'));
  assert.ok(r.calls.some(x => x[0] === 'exec' && x[2] === 'python3'));
});
test('active runner prevents broker replacement', async () => {
  const r = await deploy({ broker: true, activeRunner: true });
  assert.equal(r.code, 1);
  assert.equal(r.calls.some(x => x[0] === 'stop'), false);
});
test('unreachable broker socket restores the previous broker', async () => {
  const r = await deploy({ broker: true, socketFails: true });
  assert.equal(r.code, 1);
  assert.deepEqual(Array.from(r.calls.at(-1)), ['start', 'anythingllm']);
});
