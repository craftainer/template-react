// Prepares the lane's Keycloak for the run and puts it back afterwards:
//
// - the realm's access-token lifespan drops to ACCESS_TOKEN_SECONDS, so the
//   BFF's refresh (30 s before expiry) happens within seconds of a login;
// - the `bff` client's back-channel logout URL points at the BFF this suite
//   starts. The realm's own value is `host.docker.internal:8787` (the dev BFF
//   on the developer's machine), which a lane cannot reach, whereas Keycloak
//   and the suite share one network namespace here, so `localhost` works.
import { ACCESS_TOKEN_SECONDS, MAIN, keycloakAdmin } from "./lane";

export default async function globalSetup() {
  const admin = await keycloakAdmin();
  const realm = await admin.realm();
  const originalLifespan = realm.accessTokenLifespan;

  const client = await admin.client("bff");
  const attributes = (client.attributes ?? {}) as Record<string, string>;
  const originalLogoutUrl = attributes["backchannel.logout.url"];

  await admin.updateRealm({ accessTokenLifespan: ACCESS_TOKEN_SECONDS });
  await admin.updateClient({
    ...client,
    attributes: {
      ...attributes,
      "backchannel.logout.url": `${MAIN.origin}/bff/backchannel-logout`,
    },
  });
  await admin.dispose();

  return async () => {
    const again = await keycloakAdmin();
    const current = await again.client("bff");
    await again.updateRealm({ accessTokenLifespan: originalLifespan });
    await again.updateClient({
      ...current,
      attributes: {
        ...((current.attributes ?? {}) as Record<string, string>),
        ...(originalLogoutUrl === undefined
          ? {}
          : { "backchannel.logout.url": originalLogoutUrl }),
      },
    });
    await again.dispose();
  };
}
