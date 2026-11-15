#!/usr/bin/env bash
# Create or update the GitHub environments the template's workflows run
# privileged jobs in, so each only runs from the default branch, and print the
# commands that move its secrets into it:
#
#   release        release.yml        OCI_REGISTRY_USERNAME OCI_REGISTRY_PASSWORD
#                                     NPM_TOKEN CARGO_REGISTRY_TOKEN
#   moderation     moderate-*.yml     ANTHROPIC_API_KEY
#   template-sync  template-sync.yml  TEMPLATE_SYNC_TOKEN
#
# Dry run by default: only `gh api` GETs. `--apply` is required to PUT an
# environment and POST its branch policy. Secrets are never moved or deleted
# (values can't be read back): the script prints the `gh secret set --env` /
# `gh secret delete` commands for a human to run. Organization secrets are
# listed by name and visibility, and the ones visible to every repository are
# flagged (a branch workflow can read them; an environment can't stop that).
# Existing reviewers and wait timers on an environment are kept.
#
# Usage:
#   setup_environments.sh [--apply] [--env NAME]... [--org ORG] REPO...
#
# REPO is `owner/name`, or a bare name taken under --org (default: the owner of
# the current directory's `gh repo view`). --env may repeat and defaults to
# all three. Needs `gh` authenticated as a repository admin and `jq`.
set -euo pipefail

ORG=
APPLY=false
ENVS=()

secrets_of() {
  case "$1" in
    release) echo OCI_REGISTRY_USERNAME OCI_REGISTRY_PASSWORD NPM_TOKEN CARGO_REGISTRY_TOKEN ;;
    moderation) echo ANTHROPIC_API_KEY ;;
    template-sync) echo TEMPLATE_SYNC_TOKEN ;;
  esac
}
workflow_of() {
  case "$1" in
    release) echo release.yml ;;
    moderation) echo moderate-bug-triage.yml ;;
    template-sync) echo template-sync.yml ;;
  esac
}

usage() {
  sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

repos=()
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --dry-run) APPLY=false ;;
    --env)
      case "${2:-}" in release | moderation | template-sync) ENVS+=("$2") ;;
        *) echo "--env must be release, moderation or template-sync" >&2; exit 2 ;;
      esac
      shift ;;
    --org) ORG="${2:?--org needs a value}"; shift ;;
    -h | --help) usage; exit 0 ;;
    -*) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) repos+=("$1") ;;
  esac
  shift
done
if [ "${#repos[@]}" -eq 0 ]; then
  usage >&2
  exit 2
fi
[ "${#ENVS[@]}" -gt 0 ] || ENVS=(release moderation template-sync)
[ -n "$ORG" ] || ORG=$(gh repo view --json owner -q .owner.login)

echo "Mode: $($APPLY && echo APPLY || echo "DRY RUN (no changes; pass --apply)"); environments: ${ENVS[*]}"

# gh api GET that prints nothing instead of failing on 404.
get() {
  local out
  if out=$(gh api "$@" 2> /dev/null); then
    printf '%s\n' "$out"
  fi
}

status=0

echo
echo "== organization $ORG: secrets"
org_json=$(get "orgs/$ORG/actions/secrets")
if [ -z "$org_json" ]; then
  echo "  (cannot list organization secrets: needs org admin; skipped)"
else
  while IFS=' ' read -r name vis; do
    [ -n "$name" ] || continue
    owner_env=
    for e in "${ENVS[@]}"; do
      for s in $(secrets_of "$e"); do [ "$s" = "$name" ] && owner_env=$e; done
    done
    [ -n "$owner_env" ] || continue
    echo "  $name: visibility=$vis ($owner_env secret)"
    if [ "$vis" = all ]; then
      echo "    FLAG: visible to every repository, from any branch. Remediate (not run by this script):"
      echo "      per repo that needs it: gh secret set $name --env $owner_env -R $ORG/<repo>"
      echo "      then: gh secret delete $name --org $ORG"
    fi
  done < <(jq -r '.secrets[]? | "\(.name) \(.visibility)"' <<< "$org_json")
fi

for r in "${repos[@]}"; do
  case "$r" in */*) repo="$r" ;; *) repo="$ORG/$r" ;; esac
  echo
  echo "== $repo"
  default=$(gh api "repos/$repo" -q .default_branch) || {
    echo "  ERROR: cannot read the repository (no access?)"
    status=1
    continue
  }
  repo_json=$(get "repos/$repo/actions/secrets")
  if [ -z "$repo_json" ]; then
    echo "  ERROR: cannot list repository secrets (needs admin access)"
    status=1
    continue
  fi
  repo_secrets=$(jq -r '.secrets[]?.name' <<< "$repo_json")

  for env_name in "${ENVS[@]}"; do
    echo "  -- environment $env_name"
    env_json=$(get "repos/$repo/environments/$env_name")
    want_flags='{"protected_branches":false,"custom_branch_policies":true}'
    have_flags=null
    [ -z "$env_json" ] || have_flags=$(jq -c '.deployment_branch_policy // null' <<< "$env_json")
    if [ -z "$env_json" ] || [ "$have_flags" != "$want_flags" ]; then
      # A PUT replaces what it omits, so carry over existing protection rules.
      body=$(jq -c --argjson flags "$want_flags" '
        {deployment_branch_policy: $flags}
        + (if . == null then {} else
            ([.protection_rules[]? | select(.type == "wait_timer") | .wait_timer][0]
              // null | if . == null then {} else {wait_timer: .} end)
            + ([.protection_rules[]? | select(.type == "required_reviewers")][0]
              // null | if . == null then {} else
                  {prevent_self_review: .prevent_self_review,
                   reviewers: [.reviewers[] | {type: .type, id: .reviewer.id}]} end)
          end)' <<< "${env_json:-null}")
      [ -n "$env_json" ] && echo "    exists, policy is $have_flags -> custom branch policies" \
        || echo "    missing -> create with custom branch policies"
      echo "      PUT repos/$repo/environments/$env_name  $body"
      if $APPLY; then
        gh api --method PUT "repos/$repo/environments/$env_name" --input - <<< "$body" > /dev/null
        echo "      done"
      fi
    else
      echo "    ok (custom branch policies)"
    fi

    # Policies can be listed only once custom policies are on (else 404).
    policies=$(get "repos/$repo/environments/$env_name/deployment-branch-policies")
    have_default=false
    if [ -n "$policies" ]; then
      have_default=$(jq --arg b "$default" '[.branch_policies[]? | select(.name == $b and .type == "branch")] | length > 0' <<< "$policies")
      while IFS= read -r extra; do
        [ -n "$extra" ] || continue
        echo "    policy: unexpected '$extra' (not removed by this script; delete it by hand: the workflows' check wants exactly one rule)"
        status=1
      done < <(jq -r --arg b "$default" '.branch_policies[]? | select(.name != $b or .type != "branch") | "\(.type):\(.name)"' <<< "$policies")
    fi
    if [ "$have_default" = true ]; then
      echo "    policy: branch '$default' ok"
    else
      echo "    policy: add branch '$default'"
      echo "      POST repos/$repo/environments/$env_name/deployment-branch-policies  name=$default type=branch"
      if $APPLY; then
        gh api --method POST "repos/$repo/environments/$env_name/deployment-branch-policies" \
          -f name="$default" -f type=branch > /dev/null
        echo "      done"
      fi
    fi

    env_secrets=$(get "repos/$repo/environments/$env_name/secrets" | jq -r '.secrets[]?.name')
    wf=$(workflow_of "$env_name")
    ready=no
    if get "repos/$repo/contents/.github/workflows/$wf" -H "Accept: application/vnd.github.raw" \
      | grep -q "environment: $env_name"; then
      ready=yes
    fi
    echo "    $wf on $default declares 'environment: $env_name': $ready"
    found=false
    for s in $(secrets_of "$env_name"); do
      in_repo=false
      in_env=false
      grep -qx "$s" <<< "$repo_secrets" && in_repo=true
      grep -qx "$s" <<< "$env_secrets" && in_env=true
      $in_repo || $in_env || continue
      found=true
      echo "    secret $s: repo-level=$in_repo, $env_name-environment=$in_env"
      if $in_repo && ! $in_env; then
        echo "      gh secret set $s --env $env_name -R $repo    # paste the value; it can't be read back"
      fi
      if $in_repo; then
        echo "      gh secret delete $s -R $repo                 # only after the environment copy exists and the workflow has run once"
      fi
    done
    $found || echo "    secrets: none of $(secrets_of "$env_name") at repo or environment level"
    if [ "$ready" = no ] && [ "$found" = true ]; then
      echo "    NOTE: move secrets only after this repo's $wf has 'environment: $env_name' (template sync);"
      echo "          an older workflow reads repository secrets and would find none."
    fi
  done
done

exit "$status"
