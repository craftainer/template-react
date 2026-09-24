---
name: owasp-scan
description: Scan every file under src/ for OWASP Top Ten (2025) issues, in parallel, and report findings.
---

# OWASP Top Ten scan

Check all files under `src/` against the OWASP Top Ten (2025) categories
and report what's found. Read-only — do not fix anything unless the user
asks afterward.

## Steps

1. **List target files.** `find src/ -type f -name "*.py"` (adjust the
   extension filter if the tree isn't Python). Exclude generated/vendor
   code if any exists under `src/`.

2. **Batch them.** Group files by their top-level subdirectory under
   `src/app/` (`controllers`, `crud`, `models`, `repositories`, `views`,
   `health`, etc.), splitting further so no batch exceeds ~8 files. Each
   batch becomes one subagent task.

3. **Scan in parallel.** In a single message, launch one `Explore` agent
   per batch (`run_in_background: false` is not needed — let them run in
   parallel and collect results as they land). Give each agent:
   - The exact file list for its batch (full paths).
   - The checklist below.
   - Instruction to report only findings it can point at a concrete
     file:line and a concrete failure scenario (input/state that
     triggers it) — no generic advice, no "consider adding X" without a
     specific gap it fills.
   - Instruction to reply in under 300 words per file with findings, or
     say "no findings" for a file with none.

4. **Aggregate.** Merge all agents' findings into one list, drop
   duplicates, sort most-severe first (Injection/Broken Access
   Control/Auth failures above Security Misconfiguration above
   Logging/Monitoring gaps).

5. **Report to the user** as a single markdown list grouped by OWASP
   category, each item: `path:line — one-sentence defect — concrete
   failure scenario`. Skip categories with no findings; don't pad the
   report with reassurance about what's fine.

## OWASP Top Ten (2025) checklist for each agent

- **A01 Broken Access Control** — missing/incorrect authz checks,
  IDOR (object access by ID without ownership check), path traversal,
  CORS misconfig, and SSRF (outbound requests built from
  user-controlled URLs/hosts without allowlisting — folded into this
  category for 2025).
- **A02 Security Misconfiguration** — debug mode/verbose errors enabled
  in non-dev paths, permissive defaults, unnecessary exposed
  endpoints/features.
- **A03 Software Supply Chain Failures** — dependency/version pinned
  elsewhere with a known vulnerability you can name, unpinned/floating
  versions for security-sensitive packages, unverified third-party
  build steps or CI actions.
- **A04 Cryptographic Failures** — plaintext secrets/passwords, weak or
  homemade crypto/hashing, hardcoded keys, missing TLS enforcement.
- **A05 Injection** — SQL/NoSQL/OS command/LDAP injection via
  unsanitized input, unsafe `eval`/template rendering, missing
  parameterization.
- **A06 Insecure Design** — missing rate limiting or business-logic
  guards where abuse is plausible (only flag with a concrete abuse
  path, not speculative).
- **A07 Authentication Failures** — weak session/token handling,
  missing expiry/invalidation, predictable tokens, password rules
  absent where passwords are set.
- **A08 Software or Data Integrity Failures** — unsafe deserialization
  (pickle, yaml.load without safe loader), unsigned/unverified updates
  or artifacts.
- **A09 Security Logging & Alerting Failures** — security-relevant
  events (auth failures, access-control denials) not logged, sensitive
  data (passwords, tokens) logged in plaintext, or no alerting hook for
  events that should page someone.
- **A10 Mishandling of Exceptional Conditions** — broad/bare exception
  handlers that swallow security-relevant errors, error paths that
  fail open (e.g. an auth check that defaults to "allow" if the
  check itself throws), inconsistent error handling that leaks
  internals in one path and hides failures in another.

## Notes

- This is a read pass, not `/security-review` or `/code-review` — don't
  invoke those; this skill is narrower (OWASP-only, src/ only) and
  faster because it fans out.
- If the user wants fixes applied afterward, treat that as a separate,
  explicit follow-up — don't edit files as part of the scan itself.
