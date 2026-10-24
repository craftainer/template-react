import { createContext, useContext } from "react";
import type { CrudApi } from "./sdk";

export const CrudApiContext = createContext<CrudApi | null>(null);

/** The SDK client, cache and manifest; only inside `CrudApiProvider`. */
export function useCrudApi(): CrudApi {
  const api = useContext(CrudApiContext);
  if (!api) throw new Error("useCrudApi needs a CrudApiProvider");
  return api;
}
