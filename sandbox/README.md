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

Agent Skills use the same two tools. A globally managed skill revision is
mounted read-only at `/skills/<name>` only for the invocation that needs it;
workspace-local skills remain live under `/workspace/.agent/skills/<name>`.
`SKILL_ROOT` points at the selected package and caches are redirected to
`/workspace/.agent/cache`. The default execution timeout is 300 seconds with a
hard maximum of 1800 seconds. The runner also includes pinned `uv` for PEP 723
Python scripts.

Use `start-anythingllm.sh` to build the runner image, launch the broker, and
start AnythingLLM. Sandbox calls follow the configured global and per-tool
approval policy.
