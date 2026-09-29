const LOG_PREFIX = "\x1b[36m[SDK Timeout Patch]\x1b[0m";
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes default
const DEFAULT_MAX_RETRIES = 0;

/**
 * Raises undici's global dispatcher timeouts from the 5-minute default to
 * at least 10 minutes for the 80% use case so
 * the transport layer doesn't kill connections before the SDK does.
 *
 * When `ANYTHINGLLM_FETCH_TIMEOUT` is set (milliseconds), both the undici
 * dispatcher and the SDK-level AbortController deadline are raised to that
 * value instead — for users with slow local models that need even longer.
 *
 * Must be called before any provider module is required.
 */
function patchSdkTimeouts() {
  const envDefinedTimeout = process.env.ANYTHINGLLM_FETCH_TIMEOUT;
  const envDefinedMaxRetries = process.env.ANYTHINGLLM_MAX_RETRIES;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let maxRetries = DEFAULT_MAX_RETRIES;

  if (envDefinedTimeout) {
    const parsed = parseInt(envDefinedTimeout, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.warn(
        `${LOG_PREFIX} ANYTHINGLLM_FETCH_TIMEOUT="${envDefinedTimeout}" is not a valid positive integer — using default ${DEFAULT_TIMEOUT_MS}ms.`
      );
    } else {
      timeoutMs = parsed;
    }
  }

  if (envDefinedMaxRetries) {
    const parsed = parseInt(envDefinedMaxRetries, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      console.warn(
        `${LOG_PREFIX} ANYTHINGLLM_MAX_RETRIES="${envDefinedMaxRetries}" is not a valid non-negative integer — using default ${DEFAULT_MAX_RETRIES}.`
      );
    } else {
      maxRetries = parsed;
    }
  }

  const humanSecs = `${(timeoutMs / 1000).toFixed(0)}s`;
  try {
    // Node 24 的原生 fetch 只有在 NODE_USE_ENV_PROXY=1 时才读取代理环境变量，
    // 而 setGlobalDispatcher(plain Agent) 会把全局 dispatcher 换成不带代理的实例，
    // 之后所有 fetch（包括 3GPP 官方目录工具）都绕开代理直连，在只能经代理出网
    // 的环境里表现为 "fetch failed"（UND_ERR_CONNECT_TIMEOUT）。
    // 这里在保留超时设置的同时维持 Node 默认的代理感知 dispatcher。
    const { getGlobalDispatcher, setGlobalDispatcher } = require("undici");
    const current = getGlobalDispatcher();
    const options = { headersTimeout: timeoutMs, bodyTimeout: timeoutMs };
    const { EnvHttpProxyAgent } = require("undici");
    const dispatcher =
      current instanceof EnvHttpProxyAgent
        ? current
        : // EnvHttpProxyAgent 不能重复包裹；当前 dispatcher 不是代理感知类型时
          // （例如被其他代码替换成普通 Agent），恢复 Node 的默认代理行为。
          new EnvHttpProxyAgent(options);
    setGlobalDispatcher(dispatcher);
    console.log(
      `${LOG_PREFIX} undici global dispatcher — headersTimeout & bodyTimeout ${humanSecs} (proxy-aware)`
    );
  } catch {
    console.warn(
      `${LOG_PREFIX} undici not available — transport-level timeout not patched.`
    );
  }

  for (const [pkg, label] of [
    ["openai", "OpenAI"],
    ["@anthropic-ai/sdk", "Anthropic"],
  ]) {
    try {
      const SDK = require(pkg);
      const ClientClass = SDK.default ?? SDK[label] ?? SDK;
      let proto = ClientClass?.prototype;
      while (proto && typeof proto.buildRequest !== "function") {
        proto = Object.getPrototypeOf(proto);
      }
      if (!proto) continue;

      const origBuild = proto.buildRequest;
      proto.buildRequest = function patchedBuildRequest(options, ...rest) {
        if (!options.timeout) options.timeout = timeoutMs;
        return origBuild.call(this, options, ...rest);
      };

      if (typeof proto.makeRequest === "function") {
        const origMakeRequest = proto.makeRequest;
        proto.makeRequest = function patchedMakeRequest(
          optionsInput,
          // eslint-disable-next-line
          retriesRemaining
        ) {
          return origMakeRequest.call(this, optionsInput, maxRetries);
        };
      }

      console.log(
        `${LOG_PREFIX} ${label} SDK — timeout ${humanSecs}, maxRetries ${maxRetries}`
      );
    } catch {
      // SDK not installed
    }
  }
}

module.exports = patchSdkTimeouts;
