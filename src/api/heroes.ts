// Client for the backend's worked-example CRUD resource -- mirrors
// `app.crud_1.heroes.heroes_v2`'s HeroV2/HeroV2Create view models
// field-for-field. The list/create/delete calls themselves come from
// src/api/crud.ts's generic factory, the same way heroes_v2.py itself
// just injects Hero's types into app.controllers.crud_router's generic
// build_json_router rather than hand-writing routes.
import { createCrudClient } from "./crud";

export interface Hero {
  id: number;
  name: string | null;
  powers: string[] | null;
  power_level: number | null;
  owner_id: string;
  is_draft: boolean;
  archived_at: string | null;
  publish_at: string | null;
  unpublish_at: string | null;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface HeroCreate {
  name: string;
  powers: string[];
  power_level?: number | null;
}

export const heroesCrud = createCrudClient<Hero, HeroCreate>(
  "/crud/v1/heroes/v2/json",
);
