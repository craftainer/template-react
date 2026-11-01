# valkey

[Valkey](https://valkey.io/) (the Linux Foundation's BSD-3-Clause Redis
fork, same wire protocol) holds the BFF's server-side sessions and login
transactions (`bff/`, `@craftainer/bff`).

- Compose file: `compose.yml`
- Image: `valkey/valkey:9.1.2-alpine`
- Host (from other containers only — see root README's "Don't"): `valkey`
- Port (container-internal): `6379`
- Connection URL: `redis://valkey:6379` (the scheme is the protocol name)
- Data volume: `valkey-data` (append-only persistence enabled)

## Plaintext in the dev stack

The BFF refuses a plaintext `redis://`/`valkey://` session-store URL for any
non-loopback host unless `SESSION_STORE_ALLOW_PLAINTEXT` is set. This
dev-only service is reached over the compose network without TLS, so
`../../compose.instance.yml` sets `SESSION_STORE_URL=redis://valkey:6379`
and `SESSION_STORE_ALLOW_PLAINTEXT=true` on `myapp`. A deployment must use
`rediss://` and not set the opt-out.

## Do

- Reach this service from inside the devcontainer network rather than
  publishing the port: `valkey-cli -h valkey` (or `redis-cli -h valkey`).

## Don't

- Publish this service's port to the host, or reuse these defaults
  anywhere but local dev.

## Removing this service

Delete this directory, remove its entry from `../../compose.instance.yml`'s
`include:` and `depends_on:`, and drop the session-store variables there.
