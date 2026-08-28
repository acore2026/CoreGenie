class AgentToolContext {
  constructor({
    run,
    workspace,
    user,
    agent,
    emit,
    signal,
    approvalMode = "always_allow",
    budget = null,
    depth = 0,
    maxLocalToolCalls = null,
    taskId = null,
    taskTitle = null,
  }) {
    this.run = run;
    this.workspace = workspace;
    this.user = user;
    this.agent = agent;
    this.emit = emit;
    this.signal = signal;
    this.approvalMode = approvalMode || "always_allow";
    this.depth = depth;
    this.taskId = taskId;
    this.taskTitle = taskTitle;
    this.toolCalls = 0;
    this.maxToolCalls = Math.min(
      Number(run.configuration?.maxToolCalls) || 2_500,
      2_500
    );
    this.maxLocalToolCalls = maxLocalToolCalls || this.maxToolCalls;
    this.budget = budget || {
      calls: 0,
      subagentCalls: 0,
      actionTail: Promise.resolve(),
    };
    if (!this.budget.actionTail) this.budget.actionTail = Promise.resolve();
    if (!this.budget.operationCounts) this.budget.operationCounts = new Map();
    if (!this.budget.failureFamilyCounts)
      this.budget.failureFamilyCounts = new Map();
    if (!this.budget.capabilityBlocks) this.budget.capabilityBlocks = new Map();
    if (!this.budget.activatedSkills) this.budget.activatedSkills = new Map();
  }

  consumeToolCall() {
    this.toolCalls += 1;
    this.budget.calls += 1;
    if (this.toolCalls > this.maxLocalToolCalls)
      throw new Error(
        `Agent tool-call budget (${this.maxLocalToolCalls}) exhausted.`
      );
    if (this.budget.calls > this.maxToolCalls)
      throw new Error(
        `Agent tool-call budget (${this.maxToolCalls}) exhausted.`
      );
    if (this.signal?.aborted) throw new Error("Agent run was cancelled.");
    return this.toolCalls;
  }

  operationCount(operationKey) {
    return Number(this.budget.operationCounts.get(operationKey) || 0);
  }

  recordOperation(operationKey) {
    const count = this.operationCount(operationKey) + 1;
    this.budget.operationCounts.set(operationKey, count);
    return count;
  }

  failureFamilyCount(familyKey) {
    return Number(this.budget.failureFamilyCounts.get(familyKey) || 0);
  }

  recordFailureFamily(familyKey) {
    if (!familyKey) return 0;
    const count = this.failureFamilyCount(familyKey) + 1;
    this.budget.failureFamilyCounts.set(familyKey, count);
    return count;
  }

  clearFailureFamily(familyKey) {
    if (familyKey) this.budget.failureFamilyCounts.delete(familyKey);
  }

  capabilityBlock(scope) {
    if (!scope) return null;
    return this.budget.capabilityBlocks.get(scope) || null;
  }

  blockCapability(scope, failure) {
    if (!scope) return;
    this.budget.capabilityBlocks.set(scope, failure);
  }

  activateSkill(skill) {
    this.budget.activatedSkills.set(skill.name, skill);
  }

  activatedSkill(name) {
    return this.budget.activatedSkills.get(String(name || "")) || null;
  }

  async runAction(operation) {
    const previous = this.budget.actionTail;
    let release;
    this.budget.actionTail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

module.exports = { AgentToolContext };
