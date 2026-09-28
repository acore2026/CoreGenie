import { THOUGHT_REGEX_COMPLETE } from "@/components/WorkspaceChat/ChatContainer/ChatHistory/ThoughtContainer";
import { copyMarkdownAsRichText } from "@/utils/clipboard";
import { useState } from "react";

export default function useCopyText(delay = 2500) {
  const [copied, setCopied] = useState(false);
  const copyText = async (content) => {
    if (!content) return false;

    // Filter thinking blocks from the content if they exist
    const nonThinkingContent = content.replace(THOUGHT_REGEX_COMPLETE, "");
    try {
      const didCopy = await copyMarkdownAsRichText(nonThinkingContent);
      if (!didCopy) return false;
      setCopied(true);
      setTimeout(() => setCopied(false), delay);
      return true;
    } catch {
      return false;
    }
  };

  return { copyText, copied };
}
