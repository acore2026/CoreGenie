#!/usr/bin/env node
// CoreGenie deployment helper version: 1.15.4
// Recreate one existing container without importing another deployment's data/config.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const image = option("--image");
const name = option("--container") || "anythingllm";
const mode = option("--auth-mode");
const directory = option("--state-dir") || option("--backup-dir") ||
  fs.mkdtempSync(path.join(os.tmpdir(), "coregenie-deploy-"));
const noProxyAppend = option("--no-proxy-append");
const networkEnvFile = option("--network-env-file");
const caBundle = option("--ca-bundle");
const brokerMode = args.includes("--broker");
const appName = option("--app-container") || "anythingllm";
const CA_TARGET = "/etc/coregenie/ca-bundle.pem";
const networkKeys = new Set([
  "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
  "NO_PROXY", "no_proxy", "NODE_USE_ENV_PROXY",
]);
const envOverrides = args.flatMap((value, index) =>
  value === "--env" ? [args[index + 1]] : []
);
// Use only after the operator explicitly accepts interrupting running tasks.
const allowRunning = args.includes("--allow-running");
const docker = (...params) => execFileSync("docker", params, {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim();
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function api(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath: "/var/run/docker.sock", path: endpoint, method,
      headers: { "Content-Type": "application/json" } }, response => {
      let raw = "";
      response.on("data", data => raw += data);
      response.on("end", () => response.statusCode >= 300
        ? reject(new Error(`Docker API status ${response.statusCode}`))
        : resolve(raw ? JSON.parse(raw) : null));
    });
    request.on("error", reject);
    request.end(body ? JSON.stringify(body) : undefined);
  });
}
function networkOverrides() {
  if (!networkEnvFile) return [];
  if (!path.isAbsolute(networkEnvFile)) throw new Error("Network env file must be absolute.");
  const values = [];
  for (const line of fs.readFileSync(networkEnvFile, "utf8").split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith("#")) continue;
    const index = entry.indexOf("=");
    if (index < 1 || !networkKeys.has(entry.slice(0, index)))
      throw new Error("Network env file contains an unsupported setting.");
    values.push(entry);
  }
  if (!brokerMode && values.some(value => /^(?:HTTP_PROXY|HTTPS_PROXY|http_proxy|https_proxy)=.+/.test(value)) &&
      !values.some(value => value.startsWith("NODE_USE_ENV_PROXY=")))
    values.push("NODE_USE_ENV_PROXY=1");
  return values;
}
async function main() {
  const networkEnv = networkOverrides();
  let caSource;
  if (caBundle) {
    if (!path.isAbsolute(caBundle) || !fs.statSync(caBundle).isFile())
      throw new Error("CA bundle must be an existing absolute file.");
    caSource = fs.realpathSync(caBundle);
    if (/[,\r\n]/.test(caSource)) throw new Error("CA bundle path is not mount-safe.");
    const certificates = fs.readFileSync(caSource, "utf8").match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
    if (!certificates?.length) throw new Error("CA bundle contains no certificates.");
    for (const certificate of certificates) new (require("node:crypto").X509Certificate)(certificate);
  }
  if (envOverrides.some(value => !/^[A-Za-z_][A-Za-z0-9_]*=[^\r\n]*$/.test(value || "")))
    throw new Error("Each --env must be followed by NAME=value.");
  if (!image || !directory || !path.isAbsolute(directory) ||
      (mode && !["local", "idaas"].includes(mode)))
    throw new Error("Require --image, absolute --state-dir, and optional --auth-mode local|idaas.");
  const endpoint = process.env.DOCKER_CONTEXT
    ? docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}")
    : process.env.DOCKER_HOST || docker("context", "inspect", "--format", "{{.Endpoints.docker.Host}}");
  if (endpoint !== "unix:///var/run/docker.sock")
    throw new Error("Run this helper on the Docker host using unix:///var/run/docker.sock.");
  const old = JSON.parse(docker("inspect", name))[0];
  if (!old.State.Running) throw new Error("Expected a running source container.");
  if (args.includes("--pull")) docker("pull", image);
  const imageConfig = JSON.parse(docker("image", "inspect", image))[0];
  const imageId = imageConfig.Id;
  const active = () => {
    const output = docker("exec", brokerMode ? appName : name, "node", "-e",
      'const p=require("/app/server/utils/prisma");p.agent_runs.count({where:{status:{in:["running","queued"]}}}).then(n=>console.log("ACTIVE="+n)).finally(()=>p.$disconnect())');
    if (!/ACTIVE=0(?:\s|$)/.test(output) && !allowRunning) throw new Error("Agent tasks are running; wait before deployment or explicitly authorize --allow-running.");
    if (brokerMode && docker("ps", "--filter", "label=anythingllm.sandbox=true", "--format", "{{.ID}}") && !allowRunning)
      throw new Error("Sandbox runners are active; wait before replacing the broker.");
  };
  active();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, "container-before.json"), JSON.stringify(old, null, 2), { mode: 0o600, flag: "wx" });
  const suffix = Date.now();
  const candidate = `${name}-candidate-${suffix}`;
  const backup = `${name}-before-${suffix}`;
  const body = { ...old.Config, Image: imageId, HostConfig: old.HostConfig,
    NetworkingConfig: { EndpointsConfig: {} } };
  delete body.Hostname;
  delete body.Domainname;
  const version = imageConfig.Config?.Env?.find(value => value.startsWith("DEPLOYMENT_VERSION="));
  if (version) {
    body.Env = (body.Env || []).filter(value => !value.startsWith("DEPLOYMENT_VERSION="));
    body.Env.push(version);
  }
  for (const value of [...networkEnv, ...envOverrides]) {
    const prefix = value.slice(0, value.indexOf("=") + 1);
    body.Env = (body.Env || []).filter(entry => !entry.startsWith(prefix));
    body.Env.push(value);
  }
  if (noProxyAppend) {
    // Keep both spellings aligned: HTTP clients differ in case precedence.
    const entries = new Set([
      ...(body.Env || []).filter(value => /^(?:NO_PROXY|no_proxy)=/.test(value))
        .flatMap(value => value.slice(value.indexOf("=") + 1).split(",")),
      ...noProxyAppend.split(","),
    ].map(value => value.trim()).filter(Boolean));
    body.Env = (body.Env || []).filter(value => !/^(?:NO_PROXY|no_proxy)=/.test(value));
    for (const key of ["NO_PROXY", "no_proxy"]) body.Env.push(`${key}=${[...entries].join(",")}`);
  }
  if (caSource) {
    // Do not remove any unrelated mounts from the installation.
    if ((body.HostConfig.Binds || []).some(bind => bind.split(":")[1] === CA_TARGET))
      throw new Error("CA target is already occupied by a legacy bind mount.");
    body.HostConfig.Mounts = (body.HostConfig.Mounts || []).filter(mount => mount.Target !== CA_TARGET);
    body.HostConfig.Mounts.push({ Type: "bind", Source: caSource, Target: CA_TARGET, ReadOnly: true });
    if (!brokerMode) {
      body.Env = (body.Env || []).filter(value => !/^(?:NODE_EXTRA_CA_CERTS|SSL_CERT_FILE)=/.test(value));
      body.Env.push("NODE_EXTRA_CA_CERTS=" + CA_TARGET, "SSL_CERT_FILE=" + CA_TARGET);
    }
  }
  if (brokerMode) {
    body.Cmd = [...(body.Cmd || [])];
    const setArgument = (key, value) => {
      const index = body.Cmd.indexOf(key);
      if (index >= 0) body.Cmd.splice(index, 2);
      body.Cmd.push(key, value);
    };
    if (caSource) {
      setArgument("--ca-bundle", CA_TARGET);
      setArgument("--docker-ca-bundle", caSource);
    }
    if (networkEnv.length) {
      const env = Object.fromEntries(body.Env.map(entry => {
        const index = entry.indexOf("="); return [entry.slice(0, index), entry.slice(index + 1)];
      }));
      const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
      if (proxy !== undefined) setArgument("--proxy-url", proxy);
      const bypass = env.NO_PROXY ?? env.no_proxy;
      if (bypass !== undefined) setArgument("--no-proxy", bypass);
    }
  }
  if (mode) {
    body.Env = (body.Env || []).filter(value => !value.startsWith("COREGENIE_AUTH_MODE="));
    body.Env.push(`COREGENIE_AUTH_MODE=${mode}`);
    if (mode === "local") {
      body.Env = body.Env.filter(value => !value.startsWith("COREGENIE_IDAAS_CONFIG_FILE="));
      body.Env.push("COREGENIE_IDAAS_CONFIG_FILE=");
    }
  }
  for (const [network, settings] of Object.entries(old.NetworkSettings.Networks)) {
    body.NetworkingConfig.EndpointsConfig[network] = {
      Aliases: (settings.Aliases || []).filter(a => a !== old.Id && a !== old.Id.slice(0, 12)),
    };
  }
  await api("POST", "/containers/create?name=" + encodeURIComponent(candidate), body);
  let stopped = false, renamed = false, swapped = false;
  try {
    active();
    docker("stop", "--time", "30", name); stopped = true;
    docker("rename", name, backup); renamed = true;
    docker("rename", candidate, name); swapped = true;
    docker("start", name);
    for (let i = 0; i < 90; i++) {
      const state = JSON.parse(docker("inspect", name))[0].State;
      if (!state.Running) throw new Error("Candidate container exited.");
      let healthy = state.Health?.Status === "healthy";
      if (brokerMode) {
        try {
          const socketIndex = body.Cmd.indexOf("--socket");
          if (socketIndex < 0) throw new Error("Broker socket argument missing.");
          docker("exec", name, "python3", "-c",
            "import socket,sys; s=socket.socket(socket.AF_UNIX); s.settimeout(2); s.connect(sys.argv[1]); s.close()",
            body.Cmd[socketIndex + 1]);
          healthy = true;
        } catch { healthy = false; }
      }
      if (healthy) {
        const result = { container: name, image, imageId, backup, authMode: mode || "preserved", ports: old.HostConfig.PortBindings };
        fs.writeFileSync(path.join(directory, "deployment.json"), JSON.stringify(result, null, 2), { mode: 0o600, flag: "wx" });
        console.log(JSON.stringify(result));
        return;
      }
      await pause(2000);
    }
    throw new Error("Candidate health check timed out.");
  } catch (error) {
    if (swapped) {
      docker("stop", "--time", "10", name);
      docker("rename", name, `${name}-failed-${suffix}`);
    }
    if (!swapped) docker("rm", candidate);
    if (renamed) docker("rename", backup, name);
    if (stopped) docker("start", name);
    console.error("Previous container retained/restored; database migrations are not rolled back.");
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
