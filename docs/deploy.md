# Deploying

The owner's one-time setup on Wasmer Edge, and the addresses the site
answers on. Contributors don't need any of this: merging a PR into `main`
deploys it.

## Deploy on Wasmer Edge (one-time setup)

Deploys run through Wasmer's GitHub integration: every push to `main`
deploys. The repo holds no tokens or secrets, and nothing needs to be
configured besides the steps below. Wasmer's dashboard labels may change
slightly over time; the flow is the same.

1. **Merge the PR into `main`.**
2. **Sign in** at https://wasmer.io with the account that owns the `faezeh_yass` namespace.
3. **Create the app from the repository.**
   - In the dashboard choose **Deploy / Import from GitHub** (https://wasmer.io/new).
   - When asked, install or authorize the **Wasmer GitHub app** for the `Faezehyas` account. Granting access to just `dailydoseofplay` is enough.
   - Pick `Faezehyas/dailydoseofplay` and set the production branch to **`main`**.
   - Leave build settings empty. Wasmer reads `app.yaml` (name `dailydoseofplay`, owner `faezeh_yass`, region `fr-roub1`, a `/healthz` health check) and detects Node from `package.json` (`npm start`).
   - Click **Deploy**.

   If the dashboard only offers to connect Git to an **existing** app: deploy once from a checkout of `main`: install the CLI (`curl https://get.wasmer.io -sSfL | sh`, see https://docs.wasmer.io/install), run `wasmer login`, then `wasmer deploy --build-remote --non-interactive`. Then open the app in the dashboard → **Settings → Git** → choose **GitHub** → select `Faezehyas/dailydoseofplay` and branch `main` → **Save**. If the CLI writes `app_id` and `annotations:` into `app.yaml`, commit that change.
4. **Check the first build.** The log should show `Packaging project directory (N files…)` with N in the dozens (if N is 1 or 2 the upload was empty) and `Detected Node.js provider`. Then open https://dailydoseofplay.wasmer.app/healthz, which should return `{"ok":true,…}`.
5. **Alias `dailydoseofplay.wasmer.app`.** Every Wasmer app gets `<app-name>.wasmer.app`, and the app name is `dailydoseofplay`, so this URL is assigned automatically if no one else holds it. Check the URL shown on the app's dashboard page.
   - If it shows a suffixed URL (e.g. `dailydoseofplay-faezeh_yass.wasmer.app`), open the app → **Settings → Domains**, type `dailydoseofplay.wasmer.app`, click **Add** and follow the prompt.
   - If Wasmer refuses it, another account owns that alias. Keep the suffixed URL; the custom domain (next step) works either way.
6. **Add the custom domain.** Open the app → **Settings → Domains**, type `dailydoseofplay.com`, choose the option that adds `www.dailydoseofplay.com` and redirects the root domain to it, tick **Make this domain the default once verified**, and click **Add**.
   - Wasmer lists the DNS records to create. Add them at GoDaddy, which holds the domain: **Domain Portfolio** → `dailydoseofplay.com` → **DNS** → **DNS Records** → **Add New Record**. Today that is an `A` record for `@` and a `CNAME` for `www`, both pointing at Wasmer; copy the exact values from Wasmer's dialog.
   - Delete any `AAAA` record for `@` or `www`: Wasmer's docs say a stale one breaks verification.
   - Wait until Wasmer shows the domain as verified. It issues and renews the HTTPS certificate itself.
7. **Make the root redirect permanent (optional).** Wasmer only serves a root domain by redirecting it to `www`, and it answers with a temporary `307`. For a permanent `301`, let GoDaddy answer for the root instead:
   1. At GoDaddy: **Domain Portfolio** → `dailydoseofplay.com` → **DNS** → **Forwarding** → **Add Forwarding** → **Domain**.
   2. Choose `https://`, enter `www.dailydoseofplay.com`, choose **Permanent (301)**, and click **Save**. GoDaddy replaces and locks the `@` A record; leave the `www` CNAME pointing at Wasmer.
   3. Once DNS has updated (up to an hour, sometimes 48), run `curl -sI 'https://dailydoseofplay.com/ludo/?robot=1'`. Expect `301` and `location: https://www.dailydoseofplay.com/ludo/?robot=1`.
   4. If the check shows a certificate error, or the location drops `/ludo/?robot=1`, undo it: delete the forwarding, then put back the `@` A record from Wasmer's **Settings → Domains**.
   5. Wasmer may now mark `dailydoseofplay.com` as unverified. That is expected; keep the `www.dailydoseofplay.com` entry as it is.
8. **Smoke-test production.** Open the site in two browsers, play a friend match via the invite link, and play a robot game.

From then on, merging a PR into `main` deploys it. To roll back, pick an
earlier version on the app's **Versions** page.

## App links for the mobile app

Invite links open the mobile app (bundle ID and Android package
`com.dailydoseofplay.app`) once the site serves two files that name it:
`/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
(see **Mobile app** in `ARCHITECTURE.md`). Their values come from two
Wasmer secrets; each file is a 404 until its secret is set to a well-formed
value.

| Secret | Value | Where to find it |
|---|---|---|
| `APPLE_TEAM_ID` | The 10-character Apple team ID, e.g. `ABCDE12345` | Apple Developer → **Membership details** |
| `ANDROID_CERT_SHA256` | The SHA-256 fingerprint of the app's signing certificate, 32 hex pairs with colons (`AB:CD:…`). Several, comma-separated, when both the upload key and Google Play's signing key should open links. | Play Console → the app → **Test and release → App integrity → App signing** |

Set them in the dashboard (the app → **Settings → Secrets**) or with the
CLI, then redeploy so the server reads them
([Wasmer secrets](https://docs.wasmer.io/edge/learn/secrets)):

```bash
wasmer app secrets create --app faezeh_yass/dailydoseofplay APPLE_TEAM_ID ABCDE12345
```

Check with `curl -i https://www.dailydoseofplay.com/.well-known/assetlinks.json`:
expect `200` and `content-type: application/json`.

## Accounts (one-time setup)

Accounts (optional sign-in with Google, see **Accounts** in
[ARCHITECTURE.md](../ARCHITECTURE.md#accounts)) stay off, and the site works
exactly as without them, until the database and all three secrets exist.
`app.yaml` already sets `PUBLIC_ORIGIN` (`https://www.dailydoseofplay.com`)
and `GOOGLE_REDIRECT_URI`
(`https://www.dailydoseofplay.com/api/auth/google/callback`), and asks for a
PostgreSQL database (`capabilities.database.engine: postgres`).

1. **Create the database.** Open the app in the Wasmer dashboard →
   **Databases** → create a **PostgreSQL** database, if the deploy hasn't
   made one already. Wasmer then gives the app `DB_HOST`, `DB_PORT`,
   `DB_NAME`, `DB_USERNAME` and `DB_PASSWORD`; the server creates its tables
   on the next start.
2. **Set up Google sign-in** in the [Google Cloud console](https://console.cloud.google.com/):
   1. Create a project, e.g. "Daily Dose of Play".
   2. **Google Auth Platform → Branding** (the OAuth consent screen): app
      name `Daily Dose of Play`, a support email, home page
      `https://www.dailydoseofplay.com`, privacy policy
      `https://www.dailydoseofplay.com/privacy/`, authorized domain
      `dailydoseofplay.com`, and a developer contact email. Leave the logo
      empty: a logo needs Google's brand verification.
   3. **Audience:** External, then **Publish app** so anyone can sign in, not
      only test users. The site asks only for `openid` and `email`, which
      need no review.
   4. **Data Access:** add the scopes `openid` and `.../auth/userinfo.email`.
   5. **Clients → Create client → Web application**, named e.g.
      `dailydoseofplay`, with one **Authorized redirect URI**:
      `https://www.dailydoseofplay.com/api/auth/google/callback`. No
      JavaScript origins are needed. Copy the client ID and secret.
3. **Add the three secrets** (the app → **Settings → Secrets**, or the CLI).
   `read -rs` keeps the Google secret out of your shell history:

   ```bash
   wasmer app secrets create --app faezeh_yass/dailydoseofplay SESSION_SECRET "$(openssl rand -base64 48)"
   ```

   ```bash
   wasmer app secrets create --app faezeh_yass/dailydoseofplay GOOGLE_CLIENT_ID "<the client ID>"
   ```

   ```bash
   read -rs GOOGLE_SECRET && wasmer app secrets create --app faezeh_yass/dailydoseofplay GOOGLE_CLIENT_SECRET "$GOOGLE_SECRET"
   ```

   Then redeploy, so the server reads them. Changing `SESSION_SECRET` later
   signs everyone out.
4. **Check.** `curl -s https://www.dailydoseofplay.com/api/me` should print
   `{"accounts":true,"user":null,"signup":null}`, and the app's log
   `accounts: on (PostgreSQL)`. While something is missing it prints
   `{"accounts":false}` and the log says what, e.g. `accounts: off (missing
   GOOGLE_CLIENT_SECRET)` or `accounts: database unavailable (…)`. Then sign
   in on the site, pick a name, and delete the account from `/account/`.
5. **Check which address is the visitor's** (once, after the first deploy
   with this code; accounts may still be off). Rate limits count requests
   per client address, read from `X-Forwarded-For`. This sends 11 requests,
   each claiming another address in that header:

   ```bash
   for i in $(seq 1 11); do curl -s -o /dev/null -w '%{http_code} ' -H "X-Forwarded-For: 198.51.100.$i" https://www.dailydoseofplay.com/api/auth/google/start; done; echo
   ```

   - Ten `302`s (or `503`s while accounts are off), then `429`: Wasmer
     replaces the header or puts your address first, and the default (its
     first entry) is right. Nothing to do.
   - No `429`: Wasmer appends your address after the one you sent, so a
     visitor could pick their own. Add `CLIENT_IP_ENTRY: last` under `env:`
     in `app.yaml` (a PR), and once it's deployed, wait a minute and run the
     loop again: the 11th must now be `429`.

**Rolling back.** Pick an earlier version on the app's **Versions** page.
To hide accounts without a code change, set `ACCOUNTS` to `off` (a secret
works) and redeploy: every `/api/` route answers 503, the sign-in links
disappear, and the database keeps its data for when they come back.

## Domains

| Address | What it does |
|---|---|
| https://www.dailydoseofplay.com | The site. |
| https://dailydoseofplay.com | Redirects to `www`, keeping the path and query (step 7 above says who answers and with which code). |
| https://dailydoseofplay.wasmer.app | Wasmer's own address for the app. It serves the same site and keeps working, which helps when the custom domain has trouble. |
| `http://` on any of them | `308` to `https://` (Wasmer's default `force_https`). |

Domains are set in Wasmer's dashboard, not in `app.yaml`, and the `/healthz`
check doesn't depend on the domain. The lobby socket accepts pages from all
three addresses (`SITE_ORIGINS` in `server/app.js`).
