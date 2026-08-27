const FLOW_TYPES = {
  START: {
    type: "start",
    description: "Initialize flow variables",
    parameters: {
      variables: {
        type: "array",
        description: "List of variables to initialize",
      },
    },
  },
  API_CALL: {
    type: "apiCall",
    description: "Make an HTTP request to an API endpoint",
    parameters: {
      url: { type: "string", description: "The URL to make the request to" },
      method: { type: "string", description: "HTTP method (GET, POST, etc.)" },
      headers: {
        type: "array",
        description: "Request headers as key-value pairs",
      },
      bodyType: {
        type: "string",
        description: "Type of request body (json, form)",
      },
      body: {
        type: "string",
        description:
          "Request body content. If body type is json, always return a valid json object. If body type is form, always return a valid form data object.",
      },
      formData: { type: "array", description: "Form data as key-value pairs" },
      responseVariable: {
        type: "string",
        description: "Variable to store the response",
      },
      directOutput: {
        type: "boolean",
        description:
          "Whether to return the response directly to the user without LLM processing",
      },
    },
    examples: [
      {
        url: "https://api.example.com/data",
        method: "GET",
        headers: [{ key: "Authorization", value: "Bearer 1234567890" }],
      },
    ],
  },
  LLM_INSTRUCTION: {
    type: "llmInstruction",
    description: "Process data using LLM instructions",
    parameters: {
      instruction: {
        type: "string",
        description: "The instruction for the LLM to follow",
      },
      resultVariable: {
        type: "string",
        description: "Variable to store the processed result",
      },
    },
  },
  PREDEFINED_AGENT: {
    type: "predefinedAgent",
    description: "Delegate a task to a selected predefined Agent",
    parameters: {
      agentId: {
        type: "number",
        description: "ID of the predefined Agent to call",
      },
      task: {
        type: "string",
        description: "Task and context for the selected Agent",
      },
      resultVariable: {
        type: "string",
        description: "Variable to store the Agent result",
      },
    },
  },
  REQUEST_USER_INPUT: {
    type: "requestUserInput",
    description: "Pause the flow and prompt the user for input",
    parameters: {
      kind: { type: "string", description: "input or choice" },
      question: { type: "string", description: "Question shown to the user" },
      inputType: { type: "string", description: "Input field type" },
      placeholder: { type: "string", description: "Input placeholder" },
      options: { type: "array", description: "Choice options" },
      allowOther: { type: "boolean", description: "Allow a custom choice" },
      resultVariable: {
        type: "string",
        description: "Variable to store the user's answer",
      },
    },
  },
  WEB_SCRAPING: {
    type: "webScraping",
    description: "Scrape content from a webpage",
    parameters: {
      url: {
        type: "string",
        description: "The URL of the webpage to scrape",
      },
      resultVariable: {
        type: "string",
        description: "Variable to store the scraped content",
      },
      directOutput: {
        type: "boolean",
        description:
          "Whether to return the scraped content directly to the user without LLM processing",
      },
    },
  },
};

module.exports.FLOW_TYPES = FLOW_TYPES;
