const callSubagent = {
  name: "call-subagent",
  startupConfig: { params: {} },
  plugin: function () {
    return {
      name: this.name,
      setup(aibitat) {
        aibitat.function({
          super: aibitat,
          name: "call-subagent",
          description:
            "Delegate a bounded task to one enabled specialist Agent from the available_subagents roster in your system prompt. The specialist works independently and returns its result to you. Use the numeric Agent id exactly as listed.",
          parameters: {
            $schema: "http://json-schema.org/draft-07/schema#",
            type: "object",
            properties: {
              agentId: {
                type: "integer",
                description:
                  "Numeric id of the specialist in available_subagents.",
              },
              task: {
                type: "string",
                description:
                  "A complete, self-contained task including the context and expected output.",
              },
            },
            required: ["agentId", "task"],
            additionalProperties: false,
          },
          handler: async function ({ agentId, task }) {
            const {
              PredefinedAgent,
            } = require("../../../../models/predefinedAgent");
            const target = await PredefinedAgent.get(agentId, {
              enabledOnly: true,
            });
            if (!target || target.isBuiltinDefault)
              return "The selected custom Agent is unavailable.";

            if (typeof this.super.requestToolApproval === "function") {
              const approval = await this.super.requestToolApproval({
                skillName: "call-subagent",
                payload: { agent: target.name, task },
                description: `Delegate this task to ${target.name}`,
              });
              if (!approval.approved) return approval.message;
            }

            try {
              const { runPredefinedAgent } = require("../../subagents");
              return await runPredefinedAgent({
                aibitat: this.super,
                agentId,
                task,
                source: "tool",
              });
            } catch (error) {
              return `Subagent failed: ${error.message}`;
            }
          },
        });
      },
    };
  },
};

module.exports = { callSubagent };
