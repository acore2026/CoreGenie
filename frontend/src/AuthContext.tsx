import {
  type PropsWithChildren,
  useState,
  createContext,
  useEffect,
} from "react";
import {
  AUTH_TIMESTAMP,
  AUTH_TOKEN,
  AUTH_USER,
  USER_PROMPT_INPUT_MAP,
} from "@/utils/constants";
import System from "./models/system";
import { useNavigate } from "react-router-dom";
import { userFromStorage, type StoredUser } from "@/utils/request";

interface Session {
  user: StoredUser | null;
  authToken: string | null;
}

interface AuthState {
  store: Session;
  actions: {
    updateUser(user: StoredUser, authToken?: string): void;
    unsetUser(): void;
  };
}

export const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: PropsWithChildren) {
  const [store, setStore] = useState<Session>(() => ({
    user: userFromStorage(),
    authToken: localStorage.getItem(AUTH_TOKEN),
  }));

  const navigate = useNavigate();

  const [actions] = useState<AuthState["actions"]>({
    updateUser: (user, authToken = "") => {
      localStorage.setItem(AUTH_USER, JSON.stringify(user));
      localStorage.setItem(AUTH_TOKEN, authToken);
      setStore({ user, authToken });
    },
    unsetUser: () => {
      localStorage.removeItem(AUTH_USER);
      localStorage.removeItem(AUTH_TOKEN);
      localStorage.removeItem(AUTH_TIMESTAMP);
      localStorage.removeItem(USER_PROMPT_INPUT_MAP);
      setStore({ user: null, authToken: null });
    },
  });

  /*
   * On initial mount and whenever the token changes, fetch a new user object
   * If the user is suspended, (success === false and data === null) logout the user and redirect to the login page
   * If success is true and data is not null, update the user object in the store (multi-user mode only)
   * If success is true and data is null, do nothing (single-user mode only) with or without password protection
   */
  useEffect(() => {
    async function refreshUser() {
      const { success, user: refreshedUser } = await System.refreshUser();
      if (success && refreshedUser === null) return;

      if (!success) {
        localStorage.removeItem(AUTH_USER);
        localStorage.removeItem(AUTH_TOKEN);
        localStorage.removeItem(AUTH_TIMESTAMP);
        localStorage.removeItem(USER_PROMPT_INPUT_MAP);
        setStore({ user: null, authToken: null });
        navigate("/login");
        return;
      }

      localStorage.setItem(AUTH_USER, JSON.stringify(refreshedUser));
      setStore((prev) => ({
        ...prev,
        user: refreshedUser,
      }));
    }
    if (store.authToken) refreshUser();
  }, [store.authToken]);

  return (
    <AuthContext.Provider value={{ store, actions }}>
      {children}
    </AuthContext.Provider>
  );
}
