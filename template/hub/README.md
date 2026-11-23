# The artifact hub host

A deployable Next.js app that serves one operator's published pages on their own domain, from a
Google Cloud project they own. It is the `@supersuit/artifacts` shell wired to Firestore, Cloud
Storage and Firebase sign-in, and nothing else. It ships inside the `@supersuit/artifacts` npm
package at `template/hub/`.

**You do not deploy this by hand.** Supersuit's `create-or-update-my-artifact-hub` skill copies this
folder out of the installed package, runs `npm install`, and deploys it to Firebase App Hosting with
the settings it writes for that hub. It reads `apphosting.yaml` for the shape of the settings.

## What configures it

Everything comes from the environment. `apphosting.yaml` lists every variable; the setup writes the
real values into an `apphosting.hub.yaml` override at deploy time.

| Variable | What it is |
| --- | --- |
| `HUB_TENANT` | JSON: `{ host, owner, firebase: { apiKey, appId, authDomain, projectId }, pack?, signIn?, microsoft? }`. `authDomain` must equal `host`. `pack` is the hub's own colors, type and mark. `signIn` lists the sign-in doors, any of `"google"`, `"microsoft"` and `"email"` (default `["google"]`); `"email"` is "Email me a sign-in link" and needs Email link sign-in on in the Firebase project. `microsoft: { clientId }` is the hub's Microsoft app registration: with it, a Microsoft work email whose domain the tenant verified (ID token claim `xms_edov`, requested with `email` as optional claims) opens with no emailed link. |
| `FIREBASE_STORAGE_BUCKET` | The project's default bucket: public page media. |
| `ARTIFACT_PRIVATE_BUCKET` | A bucket with no public grant, for `media: private`. Unset, private media is refused. |
| `TENANT_PUBLISH_KEY_HUB` | The publish key (a Secret Manager secret). |
| `ARTIFACT_PASS_SECRET` | Signs the five-minute reader pass (a secret). |
| `ARTIFACT_RECIPIENT_SECRET` | Signs per-reader links (a secret). |
| `TENANT_OWNER_EMAIL_HUB` | The address the owner signs in with. Optional. |
| `TENANT_ADMINS_HUB` | Comma-separated admin sign-in addresses. Optional. |

With `HUB_TENANT` unset the app still builds, and every page says the hub is not configured yet.

## What it serves

Pages at `/<id>`, past versions at `/<id>/v/<n>`, share cards at `/<id>/share.png`, the publish and
reader APIs under `/api/`, reader sign-in at `/artifact/sign-in` (Google, Microsoft or an emailed
link, against the hub's own Firebase project, same-origin through the `/__/auth` rewrite), the
Microsoft email trust at `/api/artifact-trust-microsoft`, `/brand.json`, `/api/health`, and the
tile app door at `/frapp`.
