const path = require("path");
const { PredefinedQuickTask } = require("../../models/predefinedQuickTask");
const { ROLES } = require("../../utils/middleware/multiUserProtected");
const { normalizePath, isWithin } = require("../../utils/files");
const { toolRegistry } = require("../../tools");
const MCPCompatibilityLayer = require("../../utils/MCP");
const {
  DEFAULT_RUNTIME_KEY,
  normalizeRuntimeConfig,
} = require("../../agent-system/runtimes/registry");

const EDIT_ROLES = [ROLES.admin];
const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;
const MAX_WELCOME = 300;
const MAX_EXAMPLE_PROMPTS = 6;
const MAX_EXAMPLE_PROMPT = 240;
const MAX_EXAMPLE_PROMPT_LABEL = 120;
const MAX_EXAMPLE_PROMPT_DETAIL = 1_000;
const MAX_PROMPT = 40_000;

function cleanText(
  value: unknown,
  max: number,
  { required = false }: { required?: boolean } = {}
): string | null {
  const text = String(value ?? "")
    .trim()
    .slice(0, max);
  if (required && !text) return null;
  return text;
}

function uniqueIntegers(values: unknown): number[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(Number).filter(Number.isInteger))];
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map(String)
        .map((v) => v.trim())
        .filter(Boolean)
    ),
  ];
}

function cleanExamplePrompts(
  values: unknown
): Array<string | { label: string; prompt: string }> {
  if (!Array.isArray(values)) return [];
  const prompts: Array<string | { label: string; prompt: string }> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned =
      typeof value === "string"
        ? cleanText(value, MAX_EXAMPLE_PROMPT)
        : {
            label: cleanText(
              (value as { label?: unknown; prompt?: unknown })?.label ||
                (value as { prompt?: unknown })?.prompt,
              MAX_EXAMPLE_PROMPT_LABEL
            ),
            prompt: cleanText(
              (value as { prompt?: unknown })?.prompt,
              MAX_EXAMPLE_PROMPT_DETAIL
            ),
          };
    if (!cleaned || (typeof cleaned !== "string" && !cleaned.prompt)) continue;
    const normalized =
      typeof cleaned === "string"
        ? cleaned
        : {
            label: cleaned.label || cleaned.prompt || "",
            prompt: cleaned.prompt || "",
          };
    const fingerprint = JSON.stringify(normalized);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    prompts.push(normalized);
    if (prompts.length >= MAX_EXAMPLE_PROMPTS) break;
  }
  return prompts;
}

function validateAgentPayload(body: Record<string, any>) {
  if (
    body.quickTaskIds !== undefined &&
    (!Array.isArray(body.quickTaskIds) ||
      body.quickTaskIds.length > 12 ||
      body.quickTaskIds.some(
        (id: unknown) => !Number.isInteger(id) || (id as number) < 1
      ) ||
      new Set(body.quickTaskIds).size !== body.quickTaskIds.length)
  )
    return { error: "最多绑定 12 个不重复的快捷任务。" };
  const name = cleanText(body.name, MAX_NAME, { required: true });
  const systemPrompt = cleanText(body.systemPrompt, MAX_PROMPT, {
    required: true,
  });
  if (!name) return { error: "Agent name is required." };
  if (!systemPrompt) return { error: "Agent system prompt is required." };
  const runtimeKey =
    cleanText(body.runtimeKey, MAX_NAME) || DEFAULT_RUNTIME_KEY;
  let runtimeConfig;
  let wizard;
  try {
    wizard = require("../../utils/agentWizard").validateWizard(body.wizard);
    runtimeConfig = normalizeRuntimeConfig(runtimeKey, body.runtimeConfig);
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
  return {
    data: {
      name,
      description: cleanText(body.description, MAX_DESCRIPTION),
      welcomeMessage: cleanText(body.welcomeMessage, MAX_WELCOME) || null,
      examplePrompts: cleanExamplePrompts(body.examplePrompts),
      ...(Object.prototype.hasOwnProperty.call(body, "wizard")
        ? { wizard }
        : {}),
      tools: body.tools === null ? null : uniqueStrings(body.tools),
      skillIds: uniqueIntegers(body.skillIds),
      ...(Object.prototype.hasOwnProperty.call(body, "quickTaskIds")
        ? { quickTaskIds: body.quickTaskIds }
        : {}),
      systemPrompt,
      runtimeKey,
      runtimeConfig,
      enabled: body.enabled !== false,
      showInRoster: body.showInRoster !== false,
    },
  };
}

function validateSkillPayload(body: Record<string, any>) {
  const name = cleanText(body.name, MAX_NAME, { required: true });
  const instructions = cleanText(body.instructions, MAX_PROMPT, {
    required: true,
  });
  if (!name) return { error: "Skill name is required." };
  if (!instructions) return { error: "Skill instructions are required." };
  return {
    data: {
      name,
      description: cleanText(body.description, MAX_DESCRIPTION),
      instructions,
    },
  };
}

function validateQuickTaskPayload(body: Record<string, any>) {
  const key = cleanText(body.key, 80, { required: true });
  const title = cleanText(body.title, 100, { required: true });
  if (!key || key.length > 40 || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(key))
    return {
      error: "快捷任务标识最多 40 字符，只能使用小写字母、数字和短横线。",
    };
  if (!title) return { error: "快捷任务标题不能为空。" };
  try {
    const definition: Record<string, any> = {
      ...body.definition,
      id: key,
      title,
    };
    if (body.description?.trim())
      definition.description = cleanText(body.description, MAX_DESCRIPTION);
    else delete definition.description;
    PredefinedQuickTask.validateDefinition(definition);
    return {
      data: {
        key,
        title,
        description: cleanText(body.description, MAX_DESCRIPTION),
        definition,
        archived: body.archived === true,
      },
    };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

function iconDirectory(): string {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR, "assets", "agent-icons")
    : path.resolve(__dirname, "../../storage/assets/agent-icons");
}

function iconPath(filename: string): string | null {
  const root = iconDirectory();
  const target = path.resolve(root, normalizePath(filename));
  return isWithin(root, target) ? target : null;
}

function hasValidImageSignature(file: {
  buffer?: Buffer;
  mimetype?: string;
}): boolean {
  const buffer = file?.buffer;
  if (!Buffer.isBuffer(buffer)) return false;
  switch (file.mimetype) {
    case "image/png":
      return buffer
        .subarray(0, 8)
        .equals(Buffer.from("89504e470d0a1a0a", "hex"));
    case "image/jpeg":
      return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString());
    case "image/webp":
      return (
        buffer.subarray(0, 4).toString() === "RIFF" &&
        buffer.subarray(8, 12).toString() === "WEBP"
      );
    default:
      return false;
  }
}

function labelForTool(identifier: unknown): string {
  if (identifier === "agent.call") return "调用其他 Agent";
  return String(identifier)
    .replace(/^@@mcp_/, "MCP · ")
    .replace(/^@@/, "Custom · ")
    .replace(/#/g, " · ")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function activeToolOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  const values = [
    ...toolRegistry.list().map((tool: { id: string }) => tool.id),
    "agent.call",
    ...(await new MCPCompatibilityLayer().activeMCPServers()),
  ];
  const identifiers = values
    .map((value) => (typeof value === "string" ? value : value?.name))
    .filter(Boolean) as string[];
  return [...new Set(identifiers)].map((id) => ({
    id,
    name: labelForTool(id),
  }));
}

module.exports = {
  EDIT_ROLES,
  cleanText,
  uniqueIntegers,
  uniqueStrings,
  cleanExamplePrompts,
  validateAgentPayload,
  validateSkillPayload,
  validateQuickTaskPayload,
  iconDirectory,
  iconPath,
  hasValidImageSignature,
  labelForTool,
  activeToolOptions,
};
