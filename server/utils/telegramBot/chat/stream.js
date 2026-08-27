const { runAgentToCompletion } = require("../../../agent-system/service");
const { sendFormattedMessage } = require("../utils");
const { sendVoiceResponse } = require("../utils/media");

async function streamResponse({
  ctx = null,
  chatId = null,
  workspace = null,
  thread = null,
  message = "",
  attachments = [],
  voiceResponse = false,
}) {
  if (!ctx?.bot || !chatId || !workspace || !message)
    throw new Error("Invalid context or missing required parameters!");
  await ctx.bot.sendChatAction(chatId, "typing");
  const typingInterval = setInterval(() => {
    ctx.bot.sendChatAction(chatId, "typing").catch(() => {});
  }, 4_000);
  try {
    const result = await runAgentToCompletion({
      workspace,
      thread,
      source: "telegram",
      mode: workspace.chatMode || "automatic",
      prompt: message,
      attachments,
      configuration: { include: true, autoTitle: true },
    });
    const chunks = result.textResponse.match(/[\s\S]{1,4000}/g) || [""];
    for (const chunk of chunks)
      await sendFormattedMessage(ctx.bot, chatId, chunk, { format: true });
    if (voiceResponse)
      await sendVoiceResponse(ctx.bot, chatId, result.textResponse);
    return result;
  } finally {
    clearInterval(typingInterval);
  }
}

module.exports = { streamResponse };
