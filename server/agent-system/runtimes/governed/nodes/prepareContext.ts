const crypto = require("crypto");
const { Memory } = require("../../../../models/memory");
const { ModelCapability } = require("../../../../models/modelCapability");
const {
  createChatModel,
  selectedProvider,
} = require("../../../../resources/models");
const { retrieveWorkspaceContext } = require("../../../../tools/rag");
const {
  contentText,
  isImageAttachment,
  userContent,
} = require("../../../message");
const {
  childRunnableConfig,
  withRetrieverTrace,
} = require("../../../observability");
const { roleModel } = require("../planning.ts");
const {
  is3gppMarkdownConversionAgent,
  shouldRecallPersonalMemory,
  shouldRetrieveWorkspaceContext,
} = require("../workflows.ts");

type ContextItem = import("../types.ts").ContextItem;
type GovernedContext = import("../types.ts").GovernedContext;
type GovernedStateValue = import("../types.ts").GovernedStateValue;

function createPrepareContextNode(context: GovernedContext) {
  const { run, workspace, user, thread, agent, emit, signal, runnableConfig } =
    context;

  return async (state: GovernedStateValue) => {
    if (is3gppMarkdownConversionAgent(agent)) {
      await emit("activity.updated", {
        phase: "context",
        summaryKey: "preparing",
      });
      await emit("context.used", { taskId: null, items: [] });
      return { contextItems: [], controllerAttachments: [] };
    }

    const recallMemory = shouldRecallPersonalMemory(state.request, {
      autoRecall: run.configuration?.autoRecall,
      userId: user?.id,
    });
    const recallWorkspace = shouldRetrieveWorkspaceContext(state.request, {
      autoRecall: run.configuration?.autoRecall,
      mode: run.mode,
    });
    const summaryKey = recallMemory
      ? recallWorkspace
        ? "recalling_workspace_and_memory"
        : "recalling_memory"
      : recallWorkspace
        ? "recalling_workspace"
        : "preparing";

    await emit("activity.updated", {
      phase: "context",
      summaryKey,
    });

    const items: ContextItem[] = [];

    if (recallMemory && user) {
      const [globalMemories, workspaceMemories] = await Promise.all([
        Memory.globalForUser(user.id),
        Memory.forUserWorkspace(user.id, workspace.id),
      ]).catch(() => [[], []]);
      const memories = [...globalMemories, ...workspaceMemories].slice(0, 30);
      if (memories.length) {
        await Memory.updateLastUsed(memories.map((item: any) => item.id));
        await emit("context.memory.recalled", {
          count: memories.length,
          memories: memories.map(({ id, scope }: any) => ({ id, scope })),
        });
        for (const memory of memories) {
          items.push({
            id: `memory:${memory.id}`,
            kind: "memory",
            title: `${memory.scope === "global" ? "Global" : "Workspace"} memory`,
            text: String(memory.content || "").slice(0, 4_000),
            source: {
              id: `memory:${memory.id}`,
              url: `memory://${memory.scope}/${memory.id}`,
              title: "Recalled memory",
              text: String(memory.content || "").slice(0, 1_000),
              docSource: "memory",
            },
          });
        }
      }
    }

    if (recallWorkspace) {
      try {
        const retrieved = await withRetrieverTrace(
          "retrieve-workspace-context",
          { query: state.request, workspaceId: workspace.id },
          () =>
            retrieveWorkspaceContext({
              workspace,
              user,
              thread,
              query: state.request,
            })
        );
        await emit("context.rag.recalled", {
          count: retrieved.length,
          sources: retrieved.map((item: any) => item.source).filter(Boolean),
        });
        retrieved.slice(0, 12).forEach((item: any, index: number) =>
          items.push({
            id: `rag:${index}:${crypto
              .createHash("sha1")
              .update(String(item.text || ""))
              .digest("hex")
              .slice(0, 12)}`,
            kind: "rag",
            title: item.source?.title || `Workspace source ${index + 1}`,
            text: String(item.text || "").slice(0, 12_000),
            source: item.source,
          })
        );
      } catch (error) {
        await emit("context.failed", {
          kind: "rag",
          error: (error as Error).message,
        });
      }
    }

    let controllerAttachments: unknown[] = [];
    const imageAttachments = (state.attachments || []).filter(
      isImageAttachment
    );
    if (imageAttachments.length) {
      await ModelCapability.seedBuiltins();
      const provider = selectedProvider(workspace);
      const controllerModel = roleModel(run, "controller");
      const controllerCapability = controllerModel
        ? await ModelCapability.get(provider, controllerModel)
        : null;
      if (controllerCapability?.vision) {
        controllerAttachments = imageAttachments;
        await emit("model.routed", {
          role: "controller",
          model: controllerModel,
          capability: "vision",
          direct: true,
        });
      } else {
        const visionModel = roleModel(run, "vision");
        const visionCapability = visionModel
          ? await ModelCapability.get(provider, visionModel)
          : null;
        if (visionCapability?.vision) {
          await emit("activity.updated", {
            phase: "vision",
            summary: `Inspecting ${imageAttachments.length} visual attachment${imageAttachments.length === 1 ? "" : "s"}`,
          });
          const visionResponse = await createChatModel({
            workspace,
            model: visionModel,
            temperature: 0,
            thinking: false,
          }).invoke(
            [
              {
                role: "system",
                content:
                  "Analyze the supplied images for another Agent. Return concise factual observations, visible text, diagram relationships, and uncertainty. Do not answer the user's broader request.",
              },
              {
                role: "user",
                content: userContent(state.request, imageAttachments),
              },
            ],
            {
              ...childRunnableConfig(runnableConfig, {
                tags: ["governed-agent", "role:vision"],
                metadata: {
                  role: "vision",
                  attachmentCount: imageAttachments.length,
                },
              }),
              runName: "analyze-visual-attachments",
              signal,
            }
          );
          const analysis = contentText(visionResponse.content);
          if (analysis) {
            items.push({
              id: `vision:${run.id}`,
              kind: "vision",
              title: "Visual attachment analysis",
              text: analysis,
              source: null,
            });
          }
          await emit("model.routed", {
            role: "vision",
            model: visionModel,
            capability: "vision",
            direct: false,
          });
        } else {
          items.push({
            id: `vision-unavailable:${run.id}`,
            kind: "warning",
            title: "Visual attachments were not analyzed",
            text: "No explicitly vision-capable model is configured. Tell the user that visual content could not be inspected.",
            source: null,
          });
          await emit("model.capability_missing", {
            capability: "vision",
            controllerModel,
            visionModel,
          });
        }
      }
    }

    await emit("context.used", {
      taskId: null,
      items: items.map(({ id, kind, title }) => ({ id, kind, title })),
    });
    return { contextItems: items, controllerAttachments };
  };
}

module.exports = { createPrepareContextNode };
