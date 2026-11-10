import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { openThreadDraft } from "@/utils/threadDraft";
import { THREAD_DELETED_EVENT } from "@/components/Sidebar/events";

export default function useThreadDraftLifecycle(workspace, thread) {
  const { pathname } = useLocation();
  const submitted = Boolean(thread?.submittedAt);
  const blocked = thread?.canModify === false;
  useEffect(() => {
    if (!workspace.slug || !thread?.slug || submitted || blocked) return;
    // The previous chat can stay mounted while the next history loads.
    if (pathname !== `/workspace/${workspace.slug}/t/${thread.slug}`) return;
    // A submitted thread can be jointly editable; only drafts enter this flow.
    return openThreadDraft(workspace.slug, thread.slug, () => {
      window.dispatchEvent(
        new CustomEvent(THREAD_DELETED_EVENT, {
          detail: { workspaceSlug: workspace.slug, threadSlug: thread.slug },
        })
      );
    });
  }, [workspace.slug, thread?.slug, submitted, blocked, pathname]);
}
