import type { Agent, Skill, QuickTask } from "@/models/predefinedAgentTypes";

export type Scope = "workspace" | "global" | "personal";
export type Editor =
  | { type: "agent"; item: Agent | null }
  | { type: "skill"; item: Skill | null; scope: Scope }
  | { type: "quick-task"; item: QuickTask | null };
export interface EditorActions {
  onClose(): void;
  onSaved(): Promise<void>;
}
