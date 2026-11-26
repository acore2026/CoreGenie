import { fetchEventSource } from "@microsoft/fetch-event-source";
import { API_BASE } from "../constants";
import { baseHeaders, safeJsonParse } from "../request";

function commandHeaders(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(baseHeaders()).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

/** Browser-side SSE transport with authenticated POST commands. */
export class AgentSSETransport extends EventTarget {
  readonly uuid: string;
  readyState: number;
  supportsAgentStreaming: boolean;
  private readonly controller: AbortController;

  constructor(uuid: string) {
    super();
    this.uuid = uuid;
    this.readyState = WebSocket.CONNECTING;
    this.supportsAgentStreaming = false;
    this.controller = new AbortController();
    this.#connect();
  }

  async #connect() {
    try {
      await fetchEventSource(`${API_BASE}/agent-runs/${this.uuid}/events`, {
        method: "GET",
        headers: commandHeaders(),
        signal: this.controller.signal,
        openWhenHidden: true,
        onopen: async (response) => {
          if (!response.ok)
            throw new Error(
              `Agent SSE connection failed with status ${response.status}.`
            );
          this.readyState = WebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
        },
        onmessage: (message) => {
          this.dispatchEvent(
            new MessageEvent("message", { data: message.data })
          );
        },
        onclose: () => this.#finish(),
        onerror: (error) => {
          throw error;
        },
      });
    } catch (error) {
      if (this.controller.signal.aborted) return this.#finish();
      this.dispatchEvent(new CustomEvent("error", { detail: error }));
      this.#finish();
    }
  }

  send(jsonData: string) {
    if (this.readyState !== WebSocket.OPEN) return;
    const message = safeJsonParse(jsonData) ?? {};
    const command = ["stop", "cancel", "/exit"].includes(
      message?.feedback || message?.type
    )
      ? { type: "cancel" }
      : message;
    fetch(`${API_BASE}/agent-runs/${this.uuid}/commands`, {
      method: "POST",
      headers: { ...commandHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(command),
    })
      .then((response) => {
        if (response.ok) return;
        throw new Error(`Agent message failed with status ${response.status}.`);
      })
      .catch((error) => {
        this.dispatchEvent(new CustomEvent("error", { detail: error }));
      });
  }

  close() {
    if (
      this.readyState === WebSocket.CLOSING ||
      this.readyState === WebSocket.CLOSED
    )
      return;
    this.readyState = WebSocket.CLOSING;
    this.controller.abort();
    this.#finish();
  }

  #finish() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
}

export function createAgentSSETransport(uuid: string) {
  return new AgentSSETransport(uuid);
}
