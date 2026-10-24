// The backend's worked-example record (`app.crud_1.heroes.heroes_v2`'s
// HeroV2 view). The admin does not use it -- it is manifest-driven and works
// on plain JSON records -- but .storybook/stubs.tsx types its fixtures with it.
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
