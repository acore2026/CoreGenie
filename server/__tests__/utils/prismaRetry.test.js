/* eslint-env jest, node */
const {
  isTransientPrismaError,
  withPrismaRetry,
} = require("../../utils/prismaRetry");

describe("withPrismaRetry", () => {
  it("retries only transient SQLite/Prisma failures", async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce({ code: "P2024", message: "pool timeout" })
      .mockRejectedValueOnce(new Error("database is locked"))
      .mockResolvedValue("ok");
    await expect(withPrismaRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry semantic or constraint failures", async () => {
    const error = { code: "P2002", message: "Unique constraint failed" };
    const operation = jest.fn().mockRejectedValue(error);
    await expect(withPrismaRetry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(isTransientPrismaError(error)).toBe(false);
  });

  it("retries Prisma SQLite query execution timeouts", async () => {
    const operation = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "ConnectorError: ConnectionError(Timed out during query execution.)"
        )
      )
      .mockResolvedValue("ok");

    await expect(withPrismaRetry(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
