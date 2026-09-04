/* eslint-env jest, node */
const {
  appendText,
  appendToolCall,
  partsFromEvents,
  plainTextFromParts,
} = require("../../agent-system/messageTimeline");

describe("ReAct message timeline", () => {
  it("keeps prose and tool batches in chronological order", () => {
    const parts = [];
    appendText(parts, "text:turn-1", "I'm doing xxx");
    for (const id of ["call-1", "call-2", "call-3"])
      appendToolCall(parts, "tools:turn-1", id);
    appendText(parts, "text:turn-2", "Next xxxx");
    for (const id of ["call-4", "call-5"])
      appendToolCall(parts, "tools:turn-2", id);
    appendText(parts, "text:turn-3", "Done");

    expect(parts).toEqual([
      { id: "text:turn-1", type: "text", text: "I'm doing xxx" },
      {
        id: "tools:turn-1",
        type: "toolGroup",
        callIds: ["call-1", "call-2", "call-3"],
      },
      { id: "text:turn-2", type: "text", text: "Next xxxx" },
      {
        id: "tools:turn-2",
        type: "toolGroup",
        callIds: ["call-4", "call-5"],
      },
      { id: "text:turn-3", type: "text", text: "Done" },
    ]);
    expect(plainTextFromParts(parts)).toBe(
      "I'm doing xxx\n\nNext xxxx\n\nDone"
    );
  });

  it("rebuilds parts from persisted events and deduplicates call updates", () => {
    const events = [
      {
        type: "message.delta",
        payload: {
          messageId: "run:assistant",
          partId: "text:turn-1",
          partDelta: "Checking",
        },
      },
      {
        type: "tool.started",
        payload: { groupId: "tools:turn-1", callId: "call-1" },
      },
      {
        type: "tool.completed",
        payload: { groupId: "tools:turn-1", callId: "call-1" },
      },
      {
        type: "message.delta",
        payload: {
          messageId: "run:assistant",
          partId: "text:turn-2",
          partDelta: "Finished",
        },
      },
    ];

    expect(partsFromEvents(events, "run:assistant")).toEqual([
      { id: "text:turn-1", type: "text", text: "Checking" },
      {
        id: "tools:turn-1",
        type: "toolGroup",
        callIds: ["call-1"],
      },
      { id: "text:turn-2", type: "text", text: "Finished" },
    ]);
  });

  it("does not add extra blank lines already present in a text part", () => {
    expect(
      plainTextFromParts([
        { id: "one", type: "text", text: "First\n\n" },
        { id: "two", type: "text", text: "Second" },
      ])
    ).toBe("First\n\nSecond");
  });
});
