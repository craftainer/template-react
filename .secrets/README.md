# .secrets/

Local secret files, one file per secret. Never committed — see
`.gitignore`; only `.gitkeep` and this file are tracked.

- Reference these from compose files via `env_file:` or Docker/Compose
  `secrets:` mounts — never hardcode secret values into a compose file.
- One file per secret mirrors how Kubernetes Secrets are typically built
  from files (`kubectl create secret generic ... --from-file=.secrets/`),
  so the same layout carries over when this app is deployed there.

## Do

- Name each file exactly after the secret/key it holds.
- Keep this directory's shape (one flat file per secret) so it maps
  directly onto a Kubernetes Secret later.

## Don't

- Commit anything here besides `.gitkeep` and this `README.md` — check
  `.gitignore` if a file you added seems to have vanished from `git
  status`, don't disable the ignore rule.
- Put non-secret configuration here — that belongs in the compose files.
