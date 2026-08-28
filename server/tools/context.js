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
    maxConsecutiveNoProgress = 5,
    onNoProgress = null,
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
    this.maxConsecutiveNoProgress = Math.max(
      1,
      Number(maxConsecutiveNoProgress) || 5
    );
    this.onNoProgress = onNoProgress;
    this.consecutiveNoProgress = 0;
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
    if (!this.budget.operationResults) this.budget.operationResults = new Map();
    if (!this.budget.operationTails) this.budget.operationTails = new Map();
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
    return Number(
      this.budget.operationCounts.get(this.operationBudgetKey(operationKey)) ||
        0
    );
  }

  recordOperation(operationKey) {
    const count = this.operationCount(operationKey) + 1;
    this.budget.operationCounts.set(
      this.operationBudgetKey(operationKey),
      count
    );
    return count;
  }

  operationBudgetKey(operationKey) {
    return `${this.taskId || "run"}:${operationKey}`;
  }

  operationResult(operationKey) {
    return (
      this.budget.operationResults.get(this.operationBudgetKey(operationKey)) ||
      null
    );
  }

  rememberOperationResult(operationKey, execution) {
    this.budget.operationResults.set(
      this.operationBudgetKey(operationKey),
      execution
    );
  }

  async runOperation(operationKey, operation) {
    const budgetKey = this.operationBudgetKey(operationKey);
    const previous =
      this.budget.operationTails.get(budgetKey) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    this.budget.operationTails.set(budgetKey, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.budget.operationTails.get(budgetKey) === current)
        this.budget.operationTails.delete(budgetKey);
    }
  }

  recordProgress() {
    this.consecutiveNoProgress = 0;
  }

  recordNoProgress(result = {}) {
    this.consecutiveNoProgress += 1;
    if (this.consecutiveNoProgress < this.maxConsecutiveNoProgress)
      return this.consecutiveNoProgress;
    const error = new Error(
      `任务连续 ${this.consecutiveNoProgress} 次没有获得新结果，已停止当前步骤。`
    );
    error.name = "TaskNoProgressError";
    error.code = "TASK_NO_PROGRESS";
    error.retryable = false;
    error.lastResult = result;
    if (typeof this.onNoProgress === "function") this.onNoProgress(error);
    throw error;
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
