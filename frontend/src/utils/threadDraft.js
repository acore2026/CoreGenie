import { API_BASE, USER_PROMPT_INPUT_MAP } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";
import { v4 } from "uuid";

const active = new Map();
const touchedKey = (slug) => `thread-draft-touched:${slug}`;

export function touchThreadDraft(slug) {
  if (!slug) return;
  try {
    localStorage.setItem(touchedKey(slug), "1");
  } catch {}
  active.get(slug)?.retain();
}

export function openThreadDraft(workspaceSlug, threadSlug, onDeleted) {
  const sessionId = v4();
  let queue = Promise.resolve();
  let protectedDraft = false;
  try {
    protectedDraft = Boolean(
      localStorage.getItem(touchedKey(threadSlug)) ||
      JSON.parse(localStorage.getItem(USER_PROMPT_INPUT_MAP) || "{}")[
        threadSlug
      ]
    );
  } catch {
    protectedDraft = true;
  }
  function request(action) {
    queue = queue
      .catch(() => {})
      .then(async () => {
        const response = await fetch(
          `${API_BASE}/workspace/${workspaceSlug}/thread/${threadSlug}/draft-session`,
          {
            method: "POST",
            headers: baseHeaders(),
            keepalive: true,
            body: JSON.stringify({ sessionId, action, retain: protectedDraft }),
          }
        );
        if (!response.ok) return;
        const result = await response.json();
        if (result.deleted) onDeleted();
      })
      .catch(() => {});
  }
  const session = {
    retain() {
      if (protectedDraft) return;
      protectedDraft = true;
      request("touch");
    },
  };
  active.set(threadSlug, session);
  request("enter");
  const timer = setInterval(() => request("enter"), 30_000);
  // Sleeping tabs renew before accepting more input.
  const renew = () => request("enter");
  window.addEventListener("focus", renew);
  const release = () => request("release");
  window.addEventListener("pagehide", release);
  window.addEventListener("pageshow", renew);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", renew);
    window.removeEventListener("pagehide", release);
    window.removeEventListener("pageshow", renew);
    if (active.get(threadSlug) === session) active.delete(threadSlug);
    // Only route navigation triggers cleanup. Refresh/closing the page does not.
    if (
      window.location.pathname !== `/workspace/${workspaceSlug}/t/${threadSlug}`
    )
      request("leave");
    else request("release");
  };
}
