import UserButton from "./UserButton";
import { useMatch } from "react-router-dom";
import { AnnouncementSession } from "@/components/Announcements";

export default function UserMenu({ children }) {
  const isHome = !!useMatch("/");
  const isWorkspaceRoot = !!useMatch("/workspace/:slug");
  const isWorkspaceThread = !!useMatch("/workspace/:slug/t/:threadSlug");
  const isChatSurface = isHome || isWorkspaceRoot || isWorkspaceThread;

  return (
    <div className="w-auto h-auto">
      <AnnouncementSession />
      {children}
      {!isChatSurface && <UserButton />}
    </div>
  );
}
