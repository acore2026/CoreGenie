const { EventEmitter } = require("events");

class AgentRunEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(1_000);
  }

  channel(runId) {
    return `agent-run:${runId}`;
  }

  publish(event) {
    this.emit(this.channel(event.runId), event);
  }

  subscribe(runId, listener) {
    const channel = this.channel(runId);
    this.on(channel, listener);
    return () => this.off(channel, listener);
  }
}

const agentRunEventBus = new AgentRunEventBus();

module.exports = { AgentRunEventBus, agentRunEventBus };
