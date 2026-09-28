process.env.NODE_ENV = "development";

const asAudio = require("../../../processSingleFile/convert/asAudio");

describe("asAudio", () => {
  test("rejects the removed local Whisper provider", async () => {
    const result = await asAudio({
      fullFilePath: "/tmp/missing-audio.wav",
      filename: "audio.wav",
      options: { whisperProvider: "local" },
    });

    expect(result).toEqual({
      success: false,
      reason: expect.stringContaining("不支持音频转写服务“local”"),
      documents: [],
    });
  });
});
