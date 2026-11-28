# Run AnythingLLM in production without Docker

> [!WARNING]
> This method of deployment is **not supported** by the core-team and is to be used as a reference for your deployment.
> You are fully responsible for securing your deployment and data in this mode.
> **Any issues** experienced from bare-metal or non-containerized deployments will be **not** answered or supported.

Here you can find the scripts and known working process to run AnythingLLM outside of a Docker container.

### Minimum Requirements
> [!TIP]
> You should aim for at least 2GB of RAM. Disk storage is proportional to however much data
> you will be storing (documents, vectors, models, etc). Minimum 10GB recommended.

- Node.js 24.x
- pnpm 12.4.2


## Getting started

1. Clone the repo into your server as the user who the application will run as.
`git clone https://github.com/acore2026/CoreGenie.git`

2. `cd CoreGenie` and run `pnpm install --frozen-lockfile`. This will install all dependencies to run in production as well as debug the application.

3. `cp server/.env.example server/.env` to create the basic ENV file for where instance settings will be read from on service start.

4. Ensure that the `server/.env` file has _at least_ these keys to start. These values will persist and this file will be automatically written and managed after your first successful boot.
```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/coregenie"
STORAGE_DIR="/your/absolute/path/to/server/storage"
```

5. Edit the `frontend/.env` file for the `VITE_API_BASE` to now be set to `/api`. This is documented in the .env for which one you should use.
```
# VITE_API_BASE='http://localhost:3001/api' # Use this URL when developing locally
# VITE_API_BASE="https://$CODESPACE_NAME-3001.$GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN/api" # for GitHub Codespaces
VITE_API_BASE='/api' # Use this URL deploying on non-localhost address OR in docker.
```

## To start the application

Run these commands from the repository root. The server loads the compiled collector in the same process and serves the frontend from `server/public`.

```bash
pnpm --filter @coregenie/collector build
pnpm --filter anything-llm-frontend build
mkdir -p server/public
cp -R frontend/dist/. server/public/
pnpm prisma:generate
pnpm prisma:migrate
pnpm prod:server
```

CoreGenie listens on `http://localhost:3001` by default.

## Updating CoreGenie

Stop the CoreGenie server using the process manager that started it. Update the checkout with `git pull --ff-only origin master`, run `pnpm install --frozen-lockfile`, then repeat the build, migration and startup steps above.

## Using Nginx?

If you are using Nginx, you can use the following example configuration to proxy the requests to the server. Chats for streaming require **websocket** connections, so you need to ensure that the Nginx configuration is set up to support websockets. You can do this with a simple reverse proxy configuration.

```nginx
server {
   # Enable websocket connections for agent protocol.
   location ~* ^/api/agent-invocation/(.*) {
      proxy_pass http://0.0.0.0:3001;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "Upgrade";
   }

   listen 80;
   server_name [insert FQDN here];
   location / {
      # Prevent timeouts on long-running requests.
      proxy_connect_timeout       605;
      proxy_send_timeout          605;
      proxy_read_timeout          605;
      send_timeout                605;
      keepalive_timeout           605;

      # Enable readable HTTP Streaming for LLM streamed responses
      proxy_buffering off; 
      proxy_cache off;

      # Proxy your locally running service
      proxy_pass  http://0.0.0.0:3001;
    }
}
```