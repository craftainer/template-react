# stack/

One subdirectory per supporting service (here: the BFF's Valkey session
store). Each contains:

- `compose.yml` — the Compose fragment for that service.
- `README.md` — what it is, connection details, and how to remove it.
- `<service>.env` — local-dev-only default credentials, only for a service
  that has some (Valkey here has none).

Every fragment is listed in `../compose.instance.yml`'s `include:` list, so
all of them start together. A fragment's relative paths resolve against
that fragment's own directory.

## Devcontainer stack pattern

`../compose.instance.yml` configures the app service (`myapp`, defined in
the template-owned `../compose.yml`) and pulls every supporting service in
via its `include:` list, not via `devcontainer.json`'s `dockerComposeFile`.

No fragment here declares a `ports:` mapping or a `networks:` block:

- **No `networks:`** — every service reaches every other one by its service
  name on the default network Compose generates for this project.
- **No `ports:`** — these services are reached only from other containers.
  A host-reachable port goes in `forwardPorts`/`portsAttributes` in
  `../devcontainer.json` instead.

Every fragment's service defines a `healthcheck:`, and `myapp` lists a
matching `depends_on: <service>: condition: service_healthy` entry, so
nothing runs against a service that is still starting. Verify a healthcheck
against the real pinned image rather than assuming `curl`/`wget` exist.

## Do

- Give a new service its own subdirectory with `compose.yml` + `README.md`,
  a `healthcheck:`, and a `depends_on` entry on `myapp`.
- Pin an image tag to the app version only (`valkey/valkey:9.1.2-alpine`),
  not the OS sub-patch.

## Keeping the architecture doc current

Adding or removing a stack service, or changing how one connects, makes
`../../docs/architecture.md`'s diagram stale — update it in the same change.

## Don't

- Add a `ports:` entry to any fragment here.
- Reuse another service's volume or hostname.
- Put real credentials in a fragment — local-dev-only defaults only.
