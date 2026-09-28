const { createCatalog } = require("../utils/globalReferenceCatalog");
const prisma = require("../utils/prisma");
const { log, conclude } = require("./helpers");

(async () => {
  try {
    const result = await createCatalog().sync();
    log(`3GPP shared catalog: ${JSON.stringify(result)}`);
  } catch (error) {
    log(`3GPP catalog sync will retry: ${error.message}`);
  } finally {
    await prisma.$disconnect();
    conclude();
  }
})();
