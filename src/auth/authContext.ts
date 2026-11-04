import { createContext, useContext } from "react";
import type { BffUser } from "./bff";

/** What the app knows about the session; see AuthProvider.tsx. */
export interface AuthValue {
  readonly isLoading: boolean;
  readonly isAuthenticated: boolean;
  readonly user: BffUser | null;
  /** Navigates to the BFF login, coming back to the current page. */
  readonly login: () => void;
  /** Ends the session, then navigates to the identity provider's logout page. */
  readonly logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth needs an AuthProvider");
  return auth;
}
