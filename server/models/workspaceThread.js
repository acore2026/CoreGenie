const prisma = require("../utils/prisma");
const slugifyModule = require("slugify");
const { v4: uuidv4 } = require("uuid");
const truncate = require("truncate");

const TITLE_MAX_LENGTH = 60;
const TITLE_GENERATION_PROMPT = `Generate a concise title for this conversation.
- Use the same language as the user.
- Summarize the main intent in 3 to 8 words.
- Do not include quotes, markdown, labels, explanations, or ending punctuation.
- Do not show reasoning or thinking.
Return only the title.`;

function fallbackTitle(prompt = "") {
  const cleaned = String(prompt).replace(/\s+/g, " ").trim();
  return truncate(cleaned || WorkspaceThread.defaultName, TITLE_MAX_LENGTH);
}

function cleanGeneratedTitle(value = "") {
  const { stripThinkingFromText } = require("../utils/helpers");
  const withoutThinking = stripThinkingFromText(String(value));
  const firstLine = withoutThinking
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return null;

  const cleaned = firstLine
    .replace(/^(?:title|thread title|标题|標題)\s*[:：-]\s*/i, "")
    .replace(/^[#*_`'"“”‘’\s]+|[#*_`'"“”‘’\s.!?。！？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return truncate(cleaned, TITLE_MAX_LENGTH);
}

async function summarizeThreadTitle({ workspace, prompt, response }) {
  const { createLightweightChatModel } = require("../resources/models");
  const exchange = [
    `User: ${String(prompt).slice(0, 2_000)}`,
    response ? `Assistant: ${String(response).slice(0, 2_000)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const model = await createLightweightChatModel({
    workspace,
    temperature: 0,
    maxTokens: 64,
    thinking: false,
  });
  const completion = await model.invoke(
    [
      { role: "system", content: TITLE_GENERATION_PROMPT },
      { role: "user", content: exchange },
    ],
    { signal: AbortSignal.timeout(8000) }
  );
  return cleanGeneratedTitle(completion?.content);
}

const WorkspaceThread = {
  defaultName: "Thread",
  writable: ["name"],

  /**
   * The default Slugify module requires some additional mapping to prevent downstream issues
   * if the user is able to define a slug externally. We have to block non-escapable URL chars
   * so that is the slug is rendered it doesn't break the URL or UI when visited.
   * @param  {...any} args - slugify args for npm package.
   * @returns {string}
   */
  slugify: function (...args) {
    slugifyModule.extend({
      "+": " plus ",
      "!": " bang ",
      "@": " at ",
      "*": " splat ",
      ".": " dot ",
      ":": "",
      "~": "",
      "(": "",
      ")": "",
      "'": "",
      '"': "",
      "|": "",
    });
    return slugifyModule(...args);
  },

  new: async function (workspace, userId = null, data = {}) {
    try {
      const thread = await prisma.workspace_threads.create({
        data: {
          name: data.name ? String(data.name) : this.defaultName,
          slug: data.slug
            ? this.slugify(data.slug, { lowercase: true })
            : uuidv4(),
          user_id: userId ? Number(userId) : null,
          workspace_id: workspace.id,
        },
      });

      return { thread, message: null };
    } catch (error) {
      console.error(error.message);
      return { thread: null, message: error.message };
    }
  },

  update: async function (prevThread = null, data = {}) {
    if (!prevThread) throw new Error("No thread id provided for update");

    const validData = {};
    Object.entries(data).forEach(([key, value]) => {
      if (!this.writable.includes(key)) return;
      validData[key] = value;
    });

    if (Object.keys(validData).length === 0)
      return { thread: prevThread, message: "No valid fields to update!" };

    try {
      const thread = await prisma.workspace_threads.update({
        where: { id: prevThread.id },
        data: validData,
      });
      return { thread, message: null };
    } catch (error) {
      console.error(error.message);
      return { thread: null, message: error.message };
    }
  },

  get: async function (clause = {}) {
    try {
      const thread = await prisma.workspace_threads.findFirst({
        where: clause,
      });

      return thread || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  delete: async function (clause = {}) {
    try {
      await prisma.workspace_threads.deleteMany({
        where: clause,
      });
      return true;
    } catch (error) {
      console.error(error.message);
      return false;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    include = null
  ) {
    try {
      const results = await prisma.workspace_threads.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
        ...(include !== null ? { include } : {}),
      });
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  // The first accepted prompt supplies an immediate title. Refinement runs
  // independently of the main response and never overwrites a manual rename.
  autoRenameThread: async function ({
    workspace = null,
    thread = null,
    user = null,
    onRename = null,
    prompt: initialPrompt = null,
  }) {
    if (!workspace || !thread) return false;
    if (thread.name !== this.defaultName) return false; // don't rename if already named.

    const { WorkspaceChats } = require("./workspaceChats");
    // Existing conversations use their first saved exchange; new conversations
    // can be named before any assistant response has been persisted.
    const firstChat = await WorkspaceChats.get(
      {
        workspaceId: workspace.id,
        user_id: user?.id || null,
        thread_id: thread.id,
        include: true,
      },
      null,
      { id: "asc" }
    );
    if (!firstChat && !initialPrompt) return { renamed: false, thread };

    const { safeJsonParse } = require("../utils/http");
    const response = safeJsonParse(firstChat?.response, {})?.text || "";
    const prompt = firstChat?.prompt || initialPrompt;
    if (typeof prompt !== "string" || !prompt.trim())
      return { renamed: false, thread };
    let title = fallbackTitle(prompt);
    if (title === this.defaultName) title = `${title}…`;
    // Atomic claim also prevents concurrent requests from naming the same thread.
    const claimed = await prisma.workspace_threads.updateMany({
      where: { id: thread.id, name: this.defaultName },
      data: { name: title },
    });
    if (!claimed.count)
      return { renamed: false, thread: await this.get({ id: thread.id }) };
    const provisionalTitle = title;
    const notify = async (name) => {
      try {
        await onRename?.({ ...thread, name });
      } catch (error) {
        console.error(`Failed to notify thread rename: ${error.message}`);
      }
    };
    await notify(provisionalTitle);
    try {
      title =
        (await summarizeThreadTitle({
          workspace,
          thread,
          user,
          prompt,
          response,
        })) || title;
    } catch (error) {
      console.error(`Failed to generate thread title: ${error.message}`);
    }

    if (title === this.defaultName) title = provisionalTitle;
    const refined =
      title !== provisionalTitle
        ? await prisma.workspace_threads.updateMany({
            where: { id: thread.id, name: provisionalTitle },
            data: { name: title },
          })
        : { count: 0 };
    if (refined.count) await notify(title);
    return { renamed: true, thread: await this.get({ id: thread.id }) };
  },
};

module.exports = {
  WorkspaceThread,
  cleanGeneratedTitle,
  fallbackTitle,
  summarizeThreadTitle,
};
