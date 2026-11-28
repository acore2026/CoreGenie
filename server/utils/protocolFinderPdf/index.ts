const configAndSigning = require("./configAndSigning.ts");
const remoteZip = require("./remoteZip.ts");
const { convertWordToPdf } = require("./converter.ts");
const cacheAndQueue = require("./cacheAndQueue.ts");

module.exports = {
  getConfig: configAndSigning.getConfig,
  storageRoot: configAndSigning.storageRoot,
  pdfCacheDir: configAndSigning.pdfCacheDir,
  assertOfficialZipUrl: configAndSigning.assertOfficialZipUrl,
  pdfCacheKey: configAndSigning.pdfCacheKey,
  displayPdfFilename: configAndSigning.displayPdfFilename,
  signPdfPath: configAndSigning.signPdfPath,
  verifySignedPdf: configAndSigning.verifySignedPdf,
  getCachedPdfInfo: configAndSigning.getCachedPdfInfo,
  parseHeadHeaders: remoteZip.parseHeadHeaders,
  parseEndOfCentralDirectory: remoteZip.parseEndOfCentralDirectory,
  parseCentralDirectoryEntries: remoteZip.parseCentralDirectoryEntries,
  inspectRemoteZip: remoteZip.inspectRemoteZip,
  extractRemoteZipEntry: remoteZip.extractRemoteZipEntry,
  extractMemberBuffer: remoteZip.extractMemberBuffer,
  convertWordToPdf,
  cleanupStaleTempDirs: cacheAndQueue.cleanupStaleTempDirs,
  prunePdfCache: cacheAndQueue.prunePdfCache,
  startCacheMaintenance: cacheAndQueue.startCacheMaintenance,
  startConversion: cacheAndQueue.startConversion,
  getJobView: cacheAndQueue.getJobView,
  resetJobsForTest: cacheAndQueue.resetJobsForTest,
};
