// Generic client factory for the backend's generic CRUD router --
// mirrors app.controllers.crud_router.build_json_router there: a
// resource module injects its own record/create types into this factory
// instead of hand-writing list/create/delete functions per resource. See
// src/api/heroes.ts for the one instantiation this app currently needs.
import { apiFetch } from "./client";

export interface CrudClient<T, TCreate> {
  list(accessToken: string): Promise<T[]>;
  create(accessToken: string, record: TCreate): Promise<T>;
  remove(accessToken: string, id: number): Promise<void>;
}

/** Build a CrudClient for the JSON router mounted at `basePath` (e.g. `/crud/v1/heroes/v2/json`). */
export function createCrudClient<T, TCreate>(
  basePath: string,
): CrudClient<T, TCreate> {
  return {
    list(accessToken) {
      return apiFetch<T[]>(basePath, { accessToken });
    },
    create(accessToken, record) {
      return apiFetch<T>(basePath, {
        accessToken,
        init: { method: "POST", body: JSON.stringify(record) },
      });
    },
    remove(accessToken, id) {
      return apiFetch<void>(`${basePath}?id=${id}`, {
        accessToken,
        init: { method: "DELETE" },
      });
    },
  };
}
