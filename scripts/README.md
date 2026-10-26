# scripts/

- `develop.sh` — `../.devcontainer/Dockerfile`'s `develop`-stage setup: installs `prek`,
  the Claude Code CLI, `snip` and the GitHub CLI (`gh`), the only tooling this template requires
  regardless of instance language. An instance adds its own language
  runtime/tooling install on top, either by extending this script or
  copying its shape into a second script. Prefer the hook below over
  either. Every download goes through its `fetch` helper (bounded curl
  retries with backoff; GitHub URLs authenticated when the optional
  `github_token` BuildKit secret is present) and the installers
  that download for themselves run through `retry` (the installer script
  itself is fetched once, by `fetch`, so the two layers of retries do not
  multiply; a failed download names the installer and URL before the script
  aborts, an empty one is rejected, and `fetch` itself retries DNS and
  connect failures (curl exit 6/7) and truncated transfers (18/52/55/56) up
  to 4 times; timeouts are left to curl's own `--retry`), so CI's shared-IP
  HTTP 429s don't fail the image build. Local builds need no token.
- `post-create.sh` — the devcontainer's `postCreateCommand`: git
  `safe.directory`, `prek install`, then every `post-create.d/*.sh`.
- `develop.d/`, `post-create.d/`, `runner-setup.d/` — instance hook
  directories, empty apart from their own `README.md`; see
  `docs/TEMPLATE.md`'s "Instance extension points".
- `runner-setup.sh` — optional; the top-level `Dockerfile`'s `runner` stage
  setup: group-0 runtime user for arbitrary-UID platforms (run before copying
  app code, which is then copied read-only), then every
  `runner-setup.d/*.sh`. An instance whose runner image doesn't call it
  (an nginx runner, say) ignores it and `runner-setup.d/`.
- `image-scan.sh` — the manual-stage `image-scan` hook: Trivy over the
  tar for the current `RELEASE_VERSION`/arch in `dist/`.
- `test-image-scripts.sh` — the `image-scripts-test` hook: offline tests of
  the Makefile's repo derivation and these scripts.
- `image-smoke.sh` — `make image-smoke` (a `release-check` prerequisite):
  converts the arch's image in the release OCI tar from `dist/` to a
  docker-archive with the pinned skopeo (`docker load` can't read a buildx
  OCI tar on the classic image store), loads and runs it, and polls
  `IMAGE_SMOKE_PATH` until 2xx. Fails when there is no tar for the arch under
  test. Needs `SKOPEO_IMAGE`, which the Makefile exports; usage in the
  script's header.
- `skopeo.sh` — runs the pinned skopeo image as the caller's user with
  `dist/` mounted at `/dist`; used by `make publish` and `image-smoke.sh`.
- `check-dockerfile-versions.sh ARG...` — fails when a named `ARG` default
  differs between `.devcontainer/Dockerfile` and the top-level `Dockerfile`.
- `develop.d/10-corepack.sh` — enables pnpm via Corepack in the
  devcontainer image; `post-create.d/10-pnpm-install.sh` — installs the
  app's dependencies. Both template-react's own, run by the hooks above.
- `docker/` — the runtime image's own assets: `nginx.conf.template` and
  `docker-entrypoint.d/20-envsubst-app-config.sh`, both `COPY`'d into
  the top-level `Dockerfile`'s `runner` stage.

## Do

- Pass a token to the build as a BuildKit secret (`github_token`), never
  a `--build-arg`/`ARG`: an ARG is baked into the image history.
- Keep this script's own tools pinned to an exact version (a `# renovate:`
  ARG in `../.devcontainer/Dockerfile`) and checksum-verified where the upstream project
  publishes checksums, matching the pattern each install step here already
  follows.

## Don't

- Add a language runtime or stack-specific tool here — that belongs in the
  instance's own layer (`develop.d/`), not the base template's.
