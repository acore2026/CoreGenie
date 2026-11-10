// No administrator override: shared files are removable only by their uploader.
// Ownerless legacy files are writable only in a single-user installation.
function canDeleteGlobalDocument(document, userId, multiUserMode = true) {
  if (!document) return false;
  if (Number.isInteger(userId) && userId > 0)
    return document.createdBy === userId;
  return multiUserMode === false && document.createdBy == null;
}

module.exports = { canDeleteGlobalDocument };
