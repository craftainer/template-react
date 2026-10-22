# .storybook/

Storybook 10 configuration (ADR 0005).

- `main.ts` — story globs (`src/**/*.stories.tsx`) and addons.
- `preview.tsx` — wraps every story in the app's `ThemeProvider`, adds the
  light/dark toolbar switch (`theme` global) and installs the per-story fakes.
- `stubs.tsx` — the fakes: `parameters.auth` (`signedOut` | `signedIn` |
  `loading`) and `parameters.api` (`health`, `heroes`), plus fixtures. This is
  the instance-specific file; `preview.tsx` only needs `installApiStub`,
  `StubAuthProvider` and `StubParameters` from it.

## Do

- Write a `*.stories.tsx` next to every component, covering its loading,
  empty and error states, and signed-in and signed-out where auth matters.
- Use the theme (`sx`, `theme.vars`) in stories; the design-token lint covers
  them.

## Don't

- Hit a real backend or Keycloak from a story.
