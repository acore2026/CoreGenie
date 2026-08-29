const { z } = require("zod");
const { v4: uuidv4 } = require("uuid");
const { interrupt } = require("@langchain/langgraph");
const { defineTool } = require("./descriptor");

function normalizeUserQuestions(questions = []) {
  return questions.map(({ question, type = "text", options = [] }) => ({
    kind: type === "text" ? "input" : "choice",
    question,
    options,
    multiSelect: type === "multiple",
    allowOther: true,
  }));
}

const askUser = defineTool({
  id: "user.ask",
  name: "ask_user",
  description:
    "Pause the Agent and ask the user for information that is required to continue. Do not use this for optional clarification.",
  schema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().min(1),
          type: z.enum(["text", "single", "multiple"]).default("text"),
          options: z.array(z.string()).default([]),
        })
      )
      .min(1)
      .max(3),
  }),
  action: false,
  execute: async ({ questions }) =>
    interrupt({
      kind: "input",
      requestId: uuidv4(),
      questions: normalizeUserQuestions(questions),
    }),
});

module.exports = { askUser, normalizeUserQuestions };
