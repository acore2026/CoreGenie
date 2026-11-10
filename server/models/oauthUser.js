const { createHash, randomBytes } = require("node:crypto");
const prisma = require("../utils/prisma");

function identityFromProfile(profile, config) {
  const required = (field) => {
    const value = profile?.[field];
    if (typeof value !== "string" || !value.trim() || value.length > 512)
      throw new Error("INVALID_PROFILE");
    return value.trim();
  };
  const tenantId = required("tenantId");
  const uuid = required("uuid");
  const displayName = [profile.displayNameCn, profile.displayNameEn]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
  if (!displayName || displayName.length > 200)
    throw new Error("INVALID_PROFILE");
  const employeeNumber =
    typeof profile.employeeNumber === "string"
      ? profile.employeeNumber.trim().slice(0, 128)
      : null;
  const subject = createHash("sha256")
    .update(
      JSON.stringify([config.environment, config.clientId, tenantId, uuid])
    )
    .digest("hex");
  return { subject, displayName, employeeNumber, tenantId };
}

async function resolveOAuthUser(profile, config) {
  const identity = identityFromProfile(profile, config);
  const { subject: oauthSubject, displayName, employeeNumber } = identity;
  // The unique subject prevents parallel first logins from making duplicate users.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        let user = await tx.users.findUnique({ where: { oauthSubject } });
        const binding = config.bindings?.find(
          (entry) =>
            entry.tenantId === identity.tenantId &&
            entry.employeeNumber === identity.employeeNumber
        );
        if (!user && binding) {
          user = await tx.users.findUnique({
            where: { username: binding.username },
          });
          if (!user || user.oauthSubject || user.suspended)
            throw new Error("ACCOUNT_BINDING_FAILED");
          const updated = await tx.users.updateMany({
            where: { id: user.id, oauthSubject: null, suspended: 0 },
            data: { oauthSubject, displayName, employeeNumber },
          });
          if (updated.count !== 1) throw new Error("ACCOUNT_BINDING_FAILED");
        }
        if (user) {
          if (user.suspended) throw new Error("ACCOUNT_SUSPENDED");
          return tx.users.update({
            where: { id: user.id },
            data: { displayName, employeeNumber },
          });
        }
        return tx.users.create({
          data: {
            username: "idaas_" + oauthSubject.slice(0, 48),
            // OAuth-only accounts have no usable password or local recovery codes.
            password: require("bcryptjs").hashSync(
              randomBytes(32).toString("hex"),
              10
            ),
            oauthSubject,
            displayName,
            employeeNumber,
            role: "default",
            seen_recovery_codes: true,
          },
        });
      });
    } catch (error) {
      if (!["P2002", "P2034"].includes(error.code) || attempt === 2)
        throw error;
    }
  }
}

module.exports = { identityFromProfile, resolveOAuthUser };
