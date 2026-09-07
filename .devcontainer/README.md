# .devcontainer/

- `devcontainer.json` — references `compose.yml` as the devcontainer's
  sole `dockerComposeFile`, and configures the devcontainer itself
  (features, forwarded ports, editor settings).
- `compose.yml` — the dev service (`app`), built from the top-level
  `Dockerfile`'s `develop` stage. An instance that needs backing services
  (a database, a queue, ...) adds its own `stack/` directory (one
  subdirectory per service, each with its own compose fragment) and an
  `include:` list here pointing at them — see `stack/README.md`'s
  "Devcontainer stack pattern" convention once an instance adds one.

## Docker-in-Docker vs. the host's Docker

This devcontainer has its own isolated Docker-in-Docker daemon (the
`docker-in-docker` feature in `devcontainer.json`). It is **not** the
same daemon running any backing-service stack an instance adds — that
stack is started by whatever invoked "Reopen in Container" against the
_host's_ Docker. So `docker`/`docker compose` run from inside the
devcontainer can build and run throwaway containers of their own, but can
never see or `exec` into a sibling container an instance's `stack/`
starts — only a `docker compose` invoked on the host can.

## SSH agent forwarding

`devcontainer.json`'s `mounts` bind-mounts two possible SSH agent
sockets, and `postStartCommand` runs `resolve-ssh-agent.sh` on every
container start to symlink whichever one actually works to
`/home/vscode/.ssh-agent-resolved.sock` — the path `remoteEnv` points
`SSH_AUTH_SOCK` at. Either way, `git push` over SSH inside the container
authenticates against the same agent and keys already loaded on the
host — no key material is ever copied into the container.

The two candidates:

- `/ssh-agent` — the host's own `SSH_AUTH_SOCK` (`${localEnv:SSH_AUTH_SOCK}`),
  bind-mounted directly. This is a real Linux socket on WSL2, so normal
  Unix permissions carry through and it works as-is (see "Windows" below
  for getting an agent running there in the first place). If
  `SSH_AUTH_SOCK` is unset when the container is created (true for
  `devcontainers/ci` in `.github/workflows/checks.yml` — GitHub Actions
  runners have no agent), `@devcontainers/cli` drops the empty source and
  this mount degrades to a plain anonymous volume instead of erroring —
  harmless there since CI never pushes.
- `/ssh-agent-macos` — Docker Desktop's own agent-forwarding proxy, always
  available at the fixed path `/run/host-services/ssh-auth.sock` inside
  its VM on both macOS and Windows. macOS has no real `SSH_AUTH_SOCK`
  equivalent to WSL2's — the closest thing is this VM-internal proxy.

Both sockets arrive owned `root:root` mode `660` regardless of platform
or who owns the socket on the host side — bind-mounting a socket special
file carries over the owning uid/gid as seen inside the Docker Desktop
VM (root), not the host user's — so `remoteUser` (`vscode`) can't connect
to either without help. `resolve-ssh-agent.sh` runs `sudo chmod 666` on
each candidate before testing it (harmless: these are forwarding sockets
meant to be reachable by whatever connects to them, and chmod on a bind
mount only touches this one inode, not host files) — this needs the
passwordless `sudo` already granted to `vscode`.

Both also require an agent to actually be running on the host — on
macOS, `ssh-add -l` in a host Terminal should list a key; if it doesn't,
`ssh-add --apple-use-keychain ~/.ssh/id_ed25519` first — and a full
"Rebuild Container" after `mounts` changes (mounts don't apply to an
already-running container). `resolve-ssh-agent.sh` re-checks both
sockets on every start (not just container creation) since which one is
live can change if the host agent restarts between sessions.

### Windows

Launching VS Code the normal way (Start Menu, a desktop shortcut, or
"Open Folder") starts it with no `SSH_AUTH_SOCK` at all — Windows has
no such environment variable, even with an agent (Git Bash's own, or
the Windows OpenSSH Authentication Agent service) already holding your
keys — so this always hits the degraded-mount path above, silently, and
`git push`/`pull` inside the container has no key material to
authenticate with no matter what's in your Windows `~/.ssh`.

With Docker Desktop's WSL2 backend (not the Hyper-V backend — that one
has no comparable path), fix this by running the agent inside a WSL2
distro instead, since that's the same Linux environment Docker Desktop
runs containers in and shares socket/filesystem access with:

1. Make sure a real, user-facing WSL2 distro (e.g. Ubuntu — not just
   the internal `docker-desktop` one) is installed and enabled under
   Docker Desktop's Settings → Resources → WSL Integration.
2. Inside that distro, copy your keys in from Windows and start an
   agent:
   ```sh
   mkdir -p ~/.ssh && cp /mnt/c/Users/<you>/.ssh/id_ed25519* ~/.ssh/
   chmod 700 ~/.ssh && chmod 600 ~/.ssh/id_ed25519
   eval "$(ssh-agent -s)"
   ssh-add ~/.ssh/id_ed25519
   ```
   Put the `eval`/`ssh-add` lines in `~/.bashrc` (guard with
   `ssh-add -l >/dev/null 2>&1 ||` so it doesn't spawn a new agent every
   shell) so this survives new terminals without repeating it by hand.
3. From that same WSL shell, run `code .` — this opens VS Code via the
   Remote-WSL extension first, with `SSH_AUTH_SOCK` inherited from the
   shell that launched it.
4. From inside that window, run "Dev Containers: Reopen in Container".
   `${localEnv:SSH_AUTH_SOCK}` now resolves to the WSL2 agent socket
   instead of nothing, so the bind-mount above actually carries an
   agent through.

Git Bash's own ssh-agent doesn't help here even though it holds the
same keys: its socket is an MSYS emulation, not a real Unix socket
Docker Desktop can bind-mount into a Linux container, and `code .` run
from a Git Bash prompt doesn't change what environment the VS Code GUI
process itself starts with anyway.

## Do

- Add a new compose fragment's path to `compose.yml`'s own `include:`
  list the same time you add the fragment — an unreferenced file starts
  nothing.
- Keep service credentials and connection settings in the compose files'
  `environment:` blocks, so opening the devcontainer is the only setup
  step.

## Don't

- Bind- or volume-mount a language runtime's dependency tree, or anything
  else you don't want a host antivirus/DLP tool scanning or syncing — it
  lives purely in the container's writable layer instead. (`claude-config`
  is a deliberate, narrow exception — see `compose.yml`'s comment on that
  volume.)
- Add a `ports:` mapping or a `networks:` block anywhere here.
- Pin a feature or image version as `latest` — pin the exact version so
  Renovate can bump it deliberately.
