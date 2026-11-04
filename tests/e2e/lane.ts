// Shared by the e2e specs and the config: where the lane's pieces are, and the
// small helpers every spec needs (sign-in through the real Keycloak form, the
// session cookie, a raw look into Valkey, the BFF's log, Keycloak's admin API).
//
// The suite runs inside one container that shares Keycloak's network
// namespace (tests/e2e/run.sh), so `localhost` is Keycloak (8080) and the two
// BFFs this config starts (8081, 5173) at once.
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/** Keycloak, as the browser and the tokens' `iss` know it. */
export const KEYCLOAK = "http://localhost:8080";
export const REALM = "template-fastapi";
export const REALM_URL = `${KEYCLOAK}/realms/${REALM}`;

/** The BFF every spec but `expiry` talks to: PUBLIC_ORIGIN and its log. */
export const MAIN = {
  origin: "http://localhost:8081",
  port: 8081,
  log: process.env.E2E_BFF_LOG ?? "/tmp/bff-main.log",
};
/** A second BFF with short session timeouts, for `expiry.e2e.ts`. */
export const SHORT = {
  origin: "http://localhost:5173",
  port: 5173,
  log: process.env.E2E_BFF_SHORT_LOG ?? "/tmp/bff-short.log",
  idleSeconds: 6,
  absoluteSeconds: 15,
};

/** Access-token lifetime the global setup gives the realm (the BFF refreshes within 30 s of expiry). */
export const ACCESS_TOKEN_SECONDS = 40;
export const REFRESH_SKEW_SECONDS = 30;

export const SESSION_COOKIE = "__Host-Http-session";
export const CONSENT_COOKIE = "__Host-Http-consent";

/** The backend's address on the lane network and Valkey's, from run.sh. */
export function laneEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see tests/e2e/README.md)`);
  return value;
}

/** A path on the backend through the BFF's `crud` upstream. */
export const HEROES = "/api/crud/crud/v1/heroes/v2/json";
/** The same collection on the backend itself (the lane network address). */
export const HEROES_DIRECT = "/crud/v1/heroes/v2/json";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- sign-in

/**
 * Signs in through the real Keycloak form: a top-level navigation to
 * `/bff/login`, the form, and the redirect back through `/bff/callback`.
 * Nothing of the SPA is needed (it is stopped afterwards by `idle`).
 */
export async function signInViaBff(
  page: Page,
  origin: string,
  username: string,
  returnTo = "/",
): Promise<void> {
  await page.goto(
    `${origin}/bff/login?returnTo=${encodeURIComponent(returnTo)}`,
    {
      waitUntil: "domcontentloaded",
    },
  );
  await submitKeycloakForm(page, username);
  await page.waitForURL(`${origin}/**`);
}

/** Fills Keycloak's login form (the dev realm's password equals the username). */
export async function submitKeycloakForm(
  page: Page,
  username: string,
): Promise<void> {
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(username);
  await page.locator("#kc-login").click();
}

/** Stops whatever the SPA does in the background (it polls, and polls touch the session). */
export async function idle(page: Page): Promise<void> {
  await page.goto("about:blank");
}

/** The session cookie as the browser holds it, or undefined. */
export async function sessionCookie(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === SESSION_COOKIE);
}

/** The session id (the cookie value), failing the test when there is none. */
export async function sessionId(context: BrowserContext): Promise<string> {
  const cookie = await sessionCookie(context);
  expect(cookie, "a session cookie").toBeDefined();
  return cookie!.value;
}

/**
 * A request context that sends `cookies` verbatim. It does not use
 * Playwright's cookie jar, so the `Secure` `__Host-` cookie is sent over plain
 * http to localhost whatever the jar's rules are, and a spec controls every
 * request header (Origin, Sec-Fetch-Site, X-CSRF).
 */
export async function raw(
  baseURL: string,
  cookies: Record<string, string> = {},
  headers: Record<string, string> = {},
): Promise<APIRequestContext> {
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { ...(cookie ? { Cookie: cookie } : {}), ...headers },
  });
}

/** `Set-Cookie` header values of a response (there can be several). */
export function setCookies(response: {
  headersArray(): { name: string; value: string }[];
}): string[] {
  return response
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
}

// ----------------------------------------------------------------- Valkey

type Reply = string | number | null | Reply[] | { error: string };

/** Parses one RESP2 reply from `buffer` at `at`; `undefined` when incomplete. */
export function parseReply(
  buffer: Buffer,
  at = 0,
): { reply: Reply; next: number } | undefined {
  const eol = buffer.indexOf("\r\n", at);
  if (eol === -1) return undefined;
  const kind = String.fromCharCode(buffer[at]!);
  const line = buffer.toString("utf8", at + 1, eol);
  const after = eol + 2;
  switch (kind) {
    case "+":
      return { reply: line, next: after };
    case "-":
      return { reply: { error: line }, next: after };
    case ":":
      return { reply: Number(line), next: after };
    case "$": {
      const length = Number(line);
      if (length === -1) return { reply: null, next: after };
      if (buffer.length < after + length + 2) return undefined;
      return {
        reply: buffer.toString("utf8", after, after + length),
        next: after + length + 2,
      };
    }
    case "*": {
      const count = Number(line);
      if (count === -1) return { reply: null, next: after };
      const items: Reply[] = [];
      let next = after;
      for (let i = 0; i < count; i += 1) {
        const item = parseReply(buffer, next);
        if (item === undefined) return undefined;
        items.push(item.reply);
        next = item.next;
      }
      return { reply: items, next };
    }
    default:
      throw new Error(`unexpected RESP reply type ${kind}`);
  }
}

function encode(args: string[]): string {
  return (
    `*${args.length}\r\n` +
    args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join("")
  );
}

/**
 * Runs commands against the lane's real Valkey (the one the BFFs use) over a
 * bare RESP2 connection, and returns each command's reply. No client library
 * is needed for a handful of GET/PTTL/SET calls.
 */
export async function valkey(...commands: string[][]): Promise<Reply[]> {
  const url = new URL(laneEnv("E2E_SESSION_STORE_URL"));
  return new Promise((resolve, reject) => {
    const socket = createConnection({
      host: url.hostname,
      port: Number(url.port || 6379),
    });
    let received = Buffer.alloc(0);
    const replies: Reply[] = [];
    let offset = 0;
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(5_000, () => fail(new Error("valkey: timeout")));
    socket.on("error", fail);
    socket.on("connect", () => {
      socket.write(commands.map(encode).join(""));
    });
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      for (;;) {
        const parsed = parseReply(received, offset);
        if (parsed === undefined) break;
        replies.push(parsed.reply);
        offset = parsed.next;
        if (replies.length === commands.length) {
          socket.end();
          resolve(replies);
          return;
        }
      }
    });
  });
}

/** What the BFF keeps for a session (`sess:<id>`), or null when it is gone. */
export interface StoredSession {
  sub: string;
  sid: string | null;
  accessToken: string;
  refreshToken: string | null;
  accessExpiresAt: number;
  absoluteExpiresAt: number;
  createdAt: number;
  version: number;
}

export async function storedSession(id: string): Promise<StoredSession | null> {
  const [reply] = await valkey(["GET", `sess:${id}`]);
  if (reply === null) return null;
  if (typeof reply !== "string") throw new Error("unexpected GET reply");
  return JSON.parse(reply) as StoredSession;
}

// ------------------------------------------------------------------ logs

/** The BFF's JSON log lines (pino), parsed. */
export function logLines(path: string): Record<string, unknown>[] {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("{")) continue;
    try {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // a partial last line
    }
  }
  return lines;
}

/** Analytics events the `log` backend wrote, as `{name, url, props}`. */
export function loggedEvents(path: string) {
  return logLines(path)
    .filter((l) => l.msg === "analytics_event")
    .map((l) => ({
      name: String(l.analytics_event),
      url: String(l.analytics_url),
      props: Object.fromEntries(
        Object.entries(l)
          .filter(([key]) => key.startsWith("analytics_prop_"))
          .map(([key, value]) => [key.slice("analytics_prop_".length), value]),
      ),
    }));
}

/** Waits until `predicate` holds, polling the log (events are written asynchronously). */
export async function until<T>(
  read: () => T,
  predicate: (value: T) => boolean,
  timeoutMs = 5_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (predicate(value)) return value;
    if (Date.now() > deadline) return value;
    await sleep(100);
  }
}

// -------------------------------------------------------- Keycloak (admin)

/** An admin-API client for the dev realm (`admin`/`admin`, keycloak.env). */
export async function keycloakAdmin() {
  const api = await playwrightRequest.newContext({ baseURL: KEYCLOAK });
  const token = await api.post("/realms/master/protocol/openid-connect/token", {
    form: {
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "admin",
    },
  });
  expect(token.ok(), "Keycloak admin token").toBeTruthy();
  const bearer = `Bearer ${((await token.json()) as { access_token: string }).access_token}`;
  const headers = { Authorization: bearer };
  const admin = `/admin/realms/${REALM}`;

  return {
    async realm(): Promise<Record<string, unknown>> {
      const response = await api.get(admin, { headers });
      expect(response.ok()).toBeTruthy();
      return (await response.json()) as Record<string, unknown>;
    },
    async updateRealm(patch: Record<string, unknown>): Promise<void> {
      const response = await api.put(admin, { headers, data: patch });
      expect(response.status(), "update realm").toBe(204);
    },
    async client(clientId: string): Promise<Record<string, unknown>> {
      const response = await api.get(`${admin}/clients`, {
        headers,
        params: { clientId },
      });
      const found = (await response.json()) as Record<string, unknown>[];
      expect(found, `client ${clientId}`).toHaveLength(1);
      return found[0]!;
    },
    async updateClient(client: Record<string, unknown>): Promise<void> {
      const response = await api.put(`${admin}/clients/${String(client.id)}`, {
        headers,
        data: client,
      });
      expect(response.status(), "update client").toBe(204);
    },
    /** Ends every SSO session of the user: Keycloak then sends the back-channel logouts. */
    async logoutUser(username: string): Promise<void> {
      const users = await api.get(`${admin}/users`, {
        headers,
        params: { username, exact: "true" },
      });
      const found = (await users.json()) as { id: string }[];
      expect(found, `user ${username}`).toHaveLength(1);
      const response = await api.post(`${admin}/users/${found[0]!.id}/logout`, {
        headers,
      });
      expect(response.status(), "admin logout").toBe(204);
    },
    dispose: () => api.dispose(),
  };
}

/** A bearer token for the backend from the dev realm's password-grant client. */
export async function backendToken(
  api: APIRequestContext,
  username: string,
): Promise<string> {
  const response = await api.post(
    `${REALM_URL}/protocol/openid-connect/token`,
    {
      form: {
        grant_type: "password",
        client_id: "test-cli",
        username,
        password: username,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  return `Bearer ${((await response.json()) as { access_token: string }).access_token}`;
}
