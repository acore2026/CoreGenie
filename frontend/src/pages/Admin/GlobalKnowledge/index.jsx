import { useNavigate } from "react-router-dom";
import { GlobalKnowledgeContent } from "@/components/GlobalKnowledge";
import paths from "@/utils/paths";

// Keep existing bookmarks usable without the administrator settings shell.
export default function GlobalKnowledge() {
  const navigate = useNavigate();
  return (
    <main className="flex h-dvh items-center justify-center bg-theme-bg-container p-3 sm:p-6">
      <div className="h-full max-h-[800px] w-full max-w-4xl overflow-hidden rounded-xl border border-theme-sidebar-border bg-theme-bg-chat">
        <GlobalKnowledgeContent onClose={() => navigate(paths.home())} />
      </div>
    </main>
  );
}
