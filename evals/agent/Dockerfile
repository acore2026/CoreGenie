FROM ghcr.io/promptfoo/promptfoo:0.122.2

USER root
WORKDIR /opt/anythingllm-evals
COPY evals/agent/package.json evals/agent/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY evals/agent/ ./
RUN chown -R promptfoo:promptfoo /opt/anythingllm-evals

USER promptfoo
WORKDIR /opt/anythingllm-evals
CMD ["node", "/app/dist/src/server/index.js"]
