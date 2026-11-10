const fs = require("node:fs");
let cached;

function oauthOnly() {
  return process.env.COREGENIE_AUTH_MODE === "idaas";
}

function getConfig() {
  if (!oauthOnly()) return null;
  if (cached) return cached;
  const config = JSON.parse(
    fs.readFileSync(process.env.COREGENIE_IDAAS_CONFIG_FILE, "utf8")
  );
  const callback = new URL(config.redirectUri);
  if (
    !["http:", "https:"].includes(callback.protocol) ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash ||
    callback.pathname !== "/api/auth/idaas/callback" ||
    !config.clientId ||
    !config.clientSecret ||
    !["production", "beta"].includes(config.environment)
  )
    throw new Error("Invalid IDaaS configuration");
  cached = {
    ...config,
    origin: callback.origin,
    baseUrl:
      config.environment === "production"
        ? "https://uniportal.huawei.com"
        : "https://uniportal-beta.huawei.com",
  };
  return cached;
}

module.exports = { oauthOnly, getConfig };
