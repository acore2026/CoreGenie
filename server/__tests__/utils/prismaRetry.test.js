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

  it("serializes retried Agent persistence operations", async () => {
    const order = [];
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    const first = withPrismaRetry(async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    const second = withPrismaRetry(async () => {
      order.push("second:start");
      order.push("second:end");
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});
