import { API_BASE } from "./constants";
import { cleanHeaders } from "@/utils/apiClient";
import { baseHeaders } from "./request";

// Checks current localstorage and validates the session based on that.
export default async function validateSessionTokenForUser() {
  const isValidSession = await fetch(`${API_BASE}/system/check-token`, {
    method: "GET",
    cache: "default",
    headers: cleanHeaders({ ...baseHeaders() }),
  })
    .then((res) => res.status === 200)
    .catch(() => false);

  return isValidSession;
}
