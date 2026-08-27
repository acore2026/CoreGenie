import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Invite = {
  checkInvite: async (inviteCode) => {
    return await fetch(`${API_BASE}/invite/${inviteCode}`, {
      method: "GET",
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { invite: null, error: e.message };
      });
  },
  acceptInvite: async (inviteCode, newUserInfo = {}) => {
    return await fetch(`${API_BASE}/invite/${inviteCode}`, {
      method: "POST",
      body: JSON.stringify(newUserInfo),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { success: false, error: e.message };
      });
  },
  joinWorkspace: async (inviteCode) => {
    return fetch(`${API_BASE}/invite/${inviteCode}/join`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          return {
            success: false,
            error: result?.error || "Unable to join workspace.",
          };
        return result;
      })
      .catch((error) => ({ success: false, error: error.message }));
  },
};

export default Invite;
