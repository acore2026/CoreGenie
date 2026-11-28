import overviewMd from "@help-docs/architecture.md?raw";
import agentRuntimeMd from "@help-docs/architecture/agent-runtime.md?raw";
import configSkillsSandboxMd from "@help-docs/architecture/config-skills-sandbox.md?raw";
import dataAndDocumentsMd from "@help-docs/architecture/data-and-documents.md?raw";
import deploymentAndBoundariesMd from "@help-docs/architecture/deployment-and-boundaries.md?raw";

import workbenchSvg from "@help-docs/diagrams/workbench.svg";
import agentLifecycleSvg from "@help-docs/diagrams/agent-lifecycle.svg";
import agentRunSvg from "@help-docs/diagrams/agent-run.svg";
import sandboxSkillSvg from "@help-docs/diagrams/sandbox-skill.svg";
import dataFlowSvg from "@help-docs/diagrams/data-flow.svg";
import deploymentTopologySvg from "@help-docs/diagrams/deployment-topology.svg";

export type ArchitectureDocId =
  | "overview"
  | "agent-runtime"
  | "config-skills-sandbox"
  | "data-and-documents"
  | "deployment-and-boundaries";

export interface ArchitectureDoc {
  id: ArchitectureDocId;
  layer: "L1" | "L2";
  title: string;
  shortTitle: string;
  viewLabel: string;
  summary: string;
  sourcePath: string;
  markdown: string;
}

export const DEFAULT_ARCHITECTURE_DOC_ID: ArchitectureDocId = "overview";

export const ARCHITECTURE_DOCS: readonly ArchitectureDoc[] = [
  {
    id: "overview",
    layer: "L1",
    title: "软件架构总览",
    shortTitle: "架构总览",
    viewLabel: "全局总览",
    summary: "系统运行边界、真实聊天路由、四层能力模型与专题导航",
    sourcePath: "docs/help/architecture.md",
    markdown: overviewMd,
  },
  {
    id: "agent-runtime",
    layer: "L2",
    title: "Agent 运行时与任务调度",
    shortTitle: "Agent 运行时",
    viewLabel: "进程与执行",
    summary: "异步提交、租约心跳、SSE 无损续传、状态机与崩溃恢复",
    sourcePath: "docs/help/architecture/agent-runtime.md",
    markdown: agentRuntimeMd,
  },
  {
    id: "config-skills-sandbox",
    layer: "L2",
    title: "配置体系、Skill、工具与沙箱",
    shortTitle: "配置、Skill 与沙箱",
    viewLabel: "开发与扩展",
    summary: "agent-config 同步、Skill 三阶段、工具约束与容器沙箱隔离",
    sourcePath: "docs/help/architecture/config-skills-sandbox.md",
    markdown: configSkillsSandboxMd,
  },
  {
    id: "data-and-documents",
    layer: "L2",
    title: "文档解析、产物与数据存储",
    shortTitle: "文档与数据存储",
    viewLabel: "数据与文档流",
    summary: "进程内 Collector、3GPP 沙箱转换、产物登记与四层存储",
    sourcePath: "docs/help/architecture/data-and-documents.md",
    markdown: dataAndDocumentsMd,
  },
  {
    id: "deployment-and-boundaries",
    layer: "L2",
    title: "部署拓扑、认证与网络边界",
    shortTitle: "部署与网络边界",
    viewLabel: "部署与运行",
    summary: "单进程容器拓扑、Local/IDaaS 认证隔离、双通道代理与发布",
    sourcePath: "docs/help/architecture/deployment-and-boundaries.md",
    markdown: deploymentAndBoundariesMd,
  },
];

export const DIAGRAM_ASSETS: Readonly<Record<string, string>> = {
  "docs/help/diagrams/workbench.svg": workbenchSvg,
  "docs/help/diagrams/agent-lifecycle.svg": agentLifecycleSvg,
  "docs/help/diagrams/agent-run.svg": agentRunSvg,
  "docs/help/diagrams/sandbox-skill.svg": sandboxSkillSvg,
  "docs/help/diagrams/data-flow.svg": dataFlowSvg,
  "docs/help/diagrams/deployment-topology.svg": deploymentTopologySvg,
};

export const DOC_BY_SOURCE_PATH: Readonly<Record<string, ArchitectureDoc>> =
  Object.fromEntries(ARCHITECTURE_DOCS.map((doc) => [doc.sourcePath, doc]));

export function findArchitectureDoc(
  id: string | null | undefined
): ArchitectureDoc {
  const matched = ARCHITECTURE_DOCS.find((doc) => doc.id === id);
  return matched || ARCHITECTURE_DOCS[0];
}
