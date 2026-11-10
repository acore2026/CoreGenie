const prisma = require("../prisma");
const { oauthOnly } = require("./config");

async function validOAuthSession(claims) {
  if (!oauthOnly() && claims?.authProvider !== "idaas") return true;
  if (claims?.authProvider !== "idaas" || typeof claims.sid !== "string")
    return false;
  try {
    const session = await prisma.oauth_sessions.findUnique({
      where: { id: claims.sid },
    });
    return Boolean(
      session && session.userId === claims.id && session.expiresAt > new Date()
    );
  } catch {
    return false;
  }
}

module.exports = { validOAuthSession };
