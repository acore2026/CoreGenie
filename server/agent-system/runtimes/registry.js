const { z } = require("zod");
const { ResourceRegistry } = require("../../resources/registry");

const DEFAULT_RUNTIME_KEY = "governed-agent";
const LEGACY_DEFAULT_RUNTIME_KEY = "default-react";
const EVIDENCE_RESEARCH_RUNTIME_KEY = "evidence-research";

const roleModelSchema = z
  .object({
    attachmentMode: z.enum(["parsed", "workspace_file"]).default("parsed"),
    plannerModel: z.string().trim().min(1).nullable().optional(),
    controllerModel: z.string().trim().min(1).nullable().optional(),
    workerModel: z.string().trim().min(1).nullable().optional(),
    reviewerModel: z.string().trim().min(1).nullable().optional(),
    visionModel: z.string().trim().min(1).nullable().optional(),
    requiredCompletionTools: z
      .array(z.string().trim().min(1))
      .max(20)
      .default([]),
  })
  .strip();

const runtimeRegistry = new ResourceRegistry("Agent runtime");

runtimeRegistry.register({
  id: LEGACY_DEFAULT_RUNTIME_KEY,
  version: 1,
  label: "Legacy Default Agent",
  description: "General-purpose ReAct Agent using the existing runtime.",
  experimental: false,
  hidden: true,
  modelRoles: [],
  configSchema: z.object({}).strip(),
  load: () => require("./default"),
});

runtimeRegistry.register({
  id: DEFAULT_RUNTIME_KEY,
  version: 1,
  label: "Governed Agent",
  description:
    "Adaptive controller, dependency-aware workers, review, and durable partial results.",
  experimental: false,
  hidden: false,
  modelRoles: ["controller", "worker", "reviewer", "vision"],
  configSchema: roleModelSchema,
  load: () => require("./governed"),
});

runtimeRegistry.register({
  id: EVIDENCE_RESEARCH_RUNTIME_KEY,
  version: 1,
  label: "Evidence Research",
  description:
    "Plans research, gathers evidence in parallel, reviews gaps, and writes a cited answer.",
  experimental: true,
  hidden: true,
  modelRoles: ["planner", "worker", "reviewer"],
  configSchema: roleModelSchema,
  load: () => require("./evidenceResearch"),
});

function runtimeDefinition(key = DEFAULT_RUNTIME_KEY) {
  return (
    runtimeRegistry.get(key || DEFAULT_RUNTIME_KEY) ||
    runtimeRegistry.get(DEFAULT_RUNTIME_KEY)
  );
}

function requireRuntime(key, version = null) {
  const definition = runtimeRegistry.get(key);
  if (!definition) throw new Error(`Agent runtime "${key}" is not installed.`);
  if (version !== null && Number(version) !== definition.version)
    throw new Error(
      `Agent runtime "${key}" version ${version} is unavailable.`
    );
  return { definition, runtime: definition.load() };
}

function normalizeRuntimeConfig(key, value = {}) {
  const definition = runtimeRegistry.get(key);
  if (!definition) throw new Error(`Unknown Agent runtime "${key}".`);
  const parsed = definition.configSchema.safeParse(value || {});
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Invalid Agent runtime configuration."
    );
  return parsed.data;
}

function runtimeOptions() {
  return runtimeRegistry
    .list()
    .filter((runtime) => !runtime.hidden)
    .map((runtime) => ({
      key: runtime.id,
      version: runtime.version,
      label: runtime.label,
      description: runtime.description,
      experimental: runtime.experimental,
      modelRoles: runtime.modelRoles,
    }));
}

module.exports = {
  DEFAULT_RUNTIME_KEY,
  LEGACY_DEFAULT_RUNTIME_KEY,
  EVIDENCE_RESEARCH_RUNTIME_KEY,
  normalizeRuntimeConfig,
  requireRuntime,
  runtimeDefinition,
  runtimeOptions,
  runtimeRegistry,
};
