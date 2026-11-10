#!/usr/bin/env node
// Recreate one existing container without importing another deployment's data/config.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
};
const image = option("--image");
const name = option("--container") || "anythingllm";
const mode = option("--auth-mode");
const directory = option("--backup-dir");
const noProxyAppend = option("--no-proxy-append");
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
async function main() {
  if (envOverrides.some(value => !/^[A-Za-z_][A-Za-z0-9_]*=[^\r\n]*$/.test(value || "")))
    throw new Error("Each --env must be followed by NAME=value.");
  if (!image || !directory || !path.isAbsolute(directory) ||
      (mode && !["local", "idaas"].includes(mode)))
    throw new Error("Require --image, absolute --backup-dir, and optional --auth-mode local|idaas.");
  const old = JSON.parse(docker("inspect", name))[0];
  if (!old.State.Running) throw new Error("Expected a running source container.");
  docker("image", "inspect", image);
  const active = () => {
    const output = docker("exec", name, "node", "-e",
      'const p=require("/app/server/utils/prisma");p.agent_runs.count({where:{status:{in:["running","queued"]}}}).then(n=>console.log("ACTIVE="+n)).finally(()=>p.$disconnect())');
    if (!/ACTIVE=0(?:\s|$)/.test(output) && !allowRunning) throw new Error("Agent tasks are running; wait before deployment or explicitly authorize --allow-running.");
  };
  active();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, "container-before.json"), JSON.stringify(old, null, 2), { mode: 0o600, flag: "wx" });
  const suffix = Date.now();
  const candidate = `${name}-candidate-${suffix}`;
  const backup = `${name}-before-${suffix}`;
  const body = { ...old.Config, Image: image, HostConfig: old.HostConfig,
    NetworkingConfig: { EndpointsConfig: {} } };
  delete body.Hostname;
  delete body.Domainname;
  for (const value of envOverrides) {
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
      if (state.Health?.Status === "healthy") {
        const result = { container: name, image, backup, authMode: mode || "preserved", ports: old.HostConfig.PortBindings };
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
    if (renamed) docker("rename", backup, name);
    if (stopped) docker("start", name);
    console.error("Previous container retained/restored; database migrations are not rolled back.");
    throw error;
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
