# AnythingLLM disposable code sandbox

The `bash` and `python` agent tools call `broker.py` over a Unix socket. The
broker runs in a separate, tightly constrained, restart-managed container. Only
that narrow broker receives the Docker socket; the AnythingLLM container never
does. AnythingLLM receives only the broker socket and token through its existing
storage mount.

Each tool call starts a new container with outbound access through Docker's
bridge network, a read-only root filesystem, no capabilities, an unprivileged
user, and CPU, memory, process, file-size, time, and output limits. The
authenticated AnythingLLM workspace is mounted read/write at `/workspace`;
only the execution container and `/tmp` are discarded.

`SANDBOX_NETWORK=none` disables runner networking. `SANDBOX_PROXY` configures
the runner's HTTP(S) proxy. It defaults to `ANYTHINGLLM_PROXY` when present,
otherwise to `http://host.docker.internal:7890`. Every runner maps that stable
hostname to Docker's host gateway and receives uppercase and lowercase HTTP(S)
proxy variables, so tools such as curl, wget, and pip use the proxy without
command-line flags. The broker container remains network-disabled in either
mode.

The runner includes Bash, Python, pip, curl, wget, Git, jq/yq, ripgrep, fd,
find/grep/sed/awk, SQLite, rsync/SSH, network diagnostics, shellcheck, a native
build toolchain, and common archive formats. Python includes a practical base
set for HTTP/YAML/HTML, data and spreadsheets, images/PDF/Word documents,
validation, databases, retries, and testing; see `requirements.txt` for the
exact pinned package set. Plain `pip install` stores additional packages under
`/workspace/.python`, so they persist and remain importable in later
invocations for the same AnythingLLM workspace.

To build the runner with a package mirror, run
`docker build --build-arg PIP_INDEX_URL=https://mirror.example.org/simple -t anythingllm-sandbox:local sandbox/`
from the repository root. If the mirror requires an explicit trusted host, add
`--build-arg PIP_TRUSTED_HOST=mirror.example.org`. These settings apply during the build.

Proposal PPT Skills use pinned python-pptx and Pillow. LibreOffice Impress/Draw,
poppler-utils, and Noto CJK fonts support local slide rendering and image
previews. Rebuild the runner image after dependency changes; an existing runner
does not acquire them from an Agent configuration sync. Rendering is not visual
approval: the Skill records the separate page-by-page review.

Agent Skills use the same two tools. A globally managed skill revision is
mounted read-only at `/skills/<name>` only for the invocation that needs it;
workspace-local skills remain live under `/workspace/.agent/skills/<name>`.
`SKILL_ROOT` points at the selected package and caches are redirected to
`/workspace/.agent/cache`. The default execution timeout is 900 seconds with a
hard maximum of 7200 seconds. The runner also includes pinned `uv` for PEP 723
Python scripts.

Default capacity is 12 concurrent runners. Each runner may use up to 4 GiB RAM,
2 CPUs, 512 processes/threads, 4096 file descriptors, a 1 GiB individual file,
and 512 MiB of temporary storage. These are ceilings, not reserved allocations.
The broker has a 128-connection accept backlog. New clients wait up to 120 seconds
for a runner slot; old clients without a queue timeout wait up to 10 seconds.
Client deadlines include queue time. Scripts may contain up to 256 KiB of UTF-8
code; combined stdout/stderr remains limited to 1 MiB. The protocol allows extra
space for JSON escaping. Input writes are covered by the execution timeout.
See [execution limits](../docs/execution-limits.md) for Agent and storage limits.

Use `start-anythingllm.sh` to build the runner image, launch the broker, and
start AnythingLLM. The script also keeps a locked-down image guard container
running from the runner image. It has no network, mounts, or writable root
filesystem and only sleeps; its purpose is to make Docker treat the runner
image as in use so ordinary `docker image prune -a` and `docker system prune
-a` commands do not remove it between Agent calls. When the runner image is
rebuilt, the script replaces the guard automatically. Sandbox calls follow the
configured global and per-tool approval policy.


## Optional enterprise CA bundle

The broker accepts `--ca-bundle` (readable broker path) and
`--docker-ca-bundle` (absolute Docker-host path) together. It validates the PEM
bundle at startup and bind-mounts it read-only in each runner. Use a combined
public + enterprise trust bundle. Requests, curl, Python/OpenSSL, Git, pip and
Node receive the matching CA environment variables; verification stays enabled.
`--no-proxy` controls the runner bypass list.

Published broker images use `ghcr.io/acore2026/coregenie-sandbox-broker:<version>`.
See [deployment profiles](../docs/deployment-profiles.md) for the
`deploy-image.sh update-broker` path, including active-run checks and rollback.
Changing a broker environment alone does not configure runner trust: the broker
must receive both CA paths so it can mount the host file into each new runner.
