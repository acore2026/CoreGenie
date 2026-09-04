import { memo } from "react";
import renderMarkdown from "@/utils/chat/markdown";
import DOMPurify from "@/utils/chat/purify";
import {
  THOUGHT_REGEX_CLOSE,
  THOUGHT_REGEX_COMPLETE,
  THOUGHT_REGEX_OPEN,
  ThoughtChainComponent,
} from "./ThoughtContainer";

const RenderChatContent = memo(
  ({ role, message, messageId }) => {
    if (role !== "assistant")
      return (
        <span
          className="flex flex-col gap-y-1 text-white light:text-slate-900"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(message)),
          }}
        />
      );
    let thoughtChain = null;
    let msgToRender = message;
    if (!message) return null;

    if (message.match(THOUGHT_REGEX_COMPLETE)) {
      thoughtChain = message.match(THOUGHT_REGEX_COMPLETE)?.[0];
      msgToRender = message.replace(THOUGHT_REGEX_COMPLETE, "");
    }

    if (
      message.match(THOUGHT_REGEX_OPEN) &&
      !message.match(THOUGHT_REGEX_CLOSE)
    ) {
      thoughtChain = message;
      msgToRender = "";
    }

    return (
      <>
        {thoughtChain && (
          <ThoughtChainComponent content={thoughtChain} messageId={messageId} />
        )}
        <span
          className="flex flex-col gap-y-1 text-white light:text-slate-900"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(renderMarkdown(msgToRender)),
          }}
        />
      </>
    );
  },
  (prevProps, nextProps) =>
    prevProps.role === nextProps.role &&
    prevProps.message === nextProps.message &&
    prevProps.messageId === nextProps.messageId
);

RenderChatContent.displayName = "RenderChatContent";

export default RenderChatContent;
