const {
  publicRegistrationRateLimit,
  MAX_ATTEMPTS,
  attempts,
} = require("../../../utils/middleware/publicRegistrationRateLimit");

function responseMock() {
  return {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("public registration rate limiter", () => {
  beforeEach(() => attempts.clear());

  it("allows requests through the configured limit", () => {
    const request = { ip: "192.0.2.10" };
    const response = responseMock();
    const next = jest.fn();

    for (let index = 0; index < MAX_ATTEMPTS; index += 1)
      publicRegistrationRateLimit(request, response, next);

    expect(next).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("returns 429 after the configured limit", () => {
    const request = { ip: "192.0.2.11" };
    const response = responseMock();
    const next = jest.fn();

    for (let index = 0; index <= MAX_ATTEMPTS; index += 1)
      publicRegistrationRateLimit(request, response, next);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Retry-After",
      expect.any(String)
    );
  });
});
