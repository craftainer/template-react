# .vscode/

Workspace settings, tasks, and extension recommendations — committed so
anyone who opens this repo in VS Code gets a working, consistent setup
without configuring anything by hand.

- `extensions.json` — recommends the Dev Containers extension.
- `settings.json` — editor/workspace settings that apply both inside and
  outside the devcontainer.
- `tasks.json` — the `prek` task; an instance adds its own
  lint/type-check/test tasks and (if it debugs in-process) a
  `launch.json`.
- `launch.json` — the "Dev server" configuration (`pnpm dev` in an
  integrated terminal via `type: node-terminal`); Run and Debug just
  starts the process, it isn't attaching a debugger. Opening it in a
  browser happens on its own: `devcontainer.json`'s `portsAttributes`
  for port 5173 is set to `onAutoForward: openPreview`, so VS Code's
  own automatic port forwarding opens the Simple Browser once Vite
  binds the port — no `serverReadyAction` needed.

## Do

- Add a new lint/type-check/test entry point here as a task, mirroring
  the underlying command exactly — don't reimplement it.

## Don't

- Add a task here that needs the host's Docker daemon (e.g. anything
  that `docker compose exec`s into a sibling container) — a task run
  from this window executes inside the devcontainer, which can't reach
  those containers.
- Put container-only settings (interpreter path, in-container formatter)
  here — those belong in `devcontainer.json`'s
  `customizations.vscode.settings` instead, so they don't leak into a
  host-side window that never attaches to the container.
