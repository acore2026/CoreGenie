import { memo } from "react";
import { Warning } from "@phosphor-icons/react";
import RenderChatContent from "../RenderChatContent";
import type { CitationChunk } from "@/utils/chat/messages";
import Citations from "../Citation";
import WorkingIndicator from "../TaskPlanCard/WorkingIndicator";
import { useTranslation } from "react-i18next";
import { userFacingErrorKey } from "@/utils/userFacingError.ts";
const PromptReply = ({
  uuid,
  reply = "",
  pending,
  error,
  sources = [],
  agentStatus,
}: {
  uuid?: string;
  reply?: string;
  pending?: boolean;
  error?: unknown;
  sources?: CitationChunk[];
  agentStatus?: string;
}) => {
  const { t } = useTranslation();
  if (!reply && sources.length === 0 && !pending && !error && !agentStatus)
    return null;

  if (pending) {
    return (
      <div className="flex justify-start w-full">
        <div className="py-4 pl-0 pr-4 flex flex-col md:max-w-[80%]">
          {agentStatus ? (
            <WorkingIndicator status={agentStatus} />
          ) : (
            <div className="mt-3 ml-1 dot-falling light:invert"></div>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-start w-full">
        <div className="py-4 pl-0 pr-4 flex flex-col md:max-w-[80%]">
          <span className="inline-block p-2 rounded-lg bg-red-50 text-red-500">
            <Warning className="h-4 w-4 mb-1 inline-block" />
            <span className="text-xs">{t(userFacingErrorKey(error))}</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div key={uuid} className="flex justify-start w-full">
      <div className="py-4 pl-0 pr-4 flex flex-col w-full">
        <RenderChatContent
          role="assistant"
          key={`${uuid}-prompt-reply-content`}
          message={reply}
          messageId={uuid}
        />
        <WorkingIndicator status={agentStatus} />
        <Citations sources={sources} />
      </div>
    </div>
  );
};

export default memo(PromptReply);
