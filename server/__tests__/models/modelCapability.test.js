/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  model_capabilities: { upsert: jest.fn(), updateMany: jest.fn() },
}));
const prisma = require("../../utils/prisma");
const {
  ModelCapability,
  BUILTIN_CAPABILITIES,
} = require("../../models/modelCapability");

it("rejects GLM-5.3 vision routing and repairs only old builtin records", async () => {
  expect(
    BUILTIN_CAPABILITIES.find(({ model }) => model === "glm-5.3")
  ).toMatchObject({
    vision: false,
    contextWindow: 1_000_000,
  });
  await ModelCapability.seedBuiltins();
  expect(prisma.model_capabilities.updateMany).toHaveBeenCalledWith({
    where: {
      provider: "generic-openai",
      model: "glm-5.3",
      source: "builtin",
      OR: [{ vision: true }, { contextWindow: 131_072 }],
    },
    data: { vision: false, contextWindow: 1_000_000 },
  });
  for (const [options] of prisma.model_capabilities.upsert.mock.calls)
    expect(options.update).toEqual({});
});
