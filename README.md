# Unipi LC Planner

Shared calendar and team agendas for AIESEC in University of Piraeus.

- **Calendar**: month view of every team's events, colour-coded, with each team toggleable. Task deadlines can be shown too.
- **Agendas**: one card per member with their tasks: checkbox, deadline date and time, notes, comment thread. Tasks can have several members.
- **Teams**: teams, members, roles, and the AIESEC email each member signs in with.
- **Sign-in**: Google sign-in, limited to `@aiesec.gr` accounts. The limit is enforced by the database rules on Google's servers, not just hidden in the page.

It's a static site (plain HTML, CSS and JavaScript, no build step), hosted free on GitHub Pages. Data and sign-in run on Firebase's free plan.

---

## One-time setup (about 15 minutes)

You need a Google account to own the Firebase project. Use a shared LC account if you have one, so access doesn't leave with one person.

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Create a project**. Name it e.g. `unipi-lc-planner`. Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**. Choose a support email and save.
3. **Build → Firestore Database → Create database**. Pick the `eur3 (europe-west)` location and start in **production mode**.
4. In Firestore, open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.

### 2. Connect the site to Firebase

1. In Firebase: **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app (no Hosting needed).
2. Copy the `firebaseConfig` values it shows into [`js/config.js`](js/config.js), replacing the `REPLACE_ME` values. These values aren't secret; the rules protect the data.
3. Commit and push the change.

### 3. Turn on GitHub Pages

1. In this GitHub repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Every push to `main` now deploys automatically (see the **Actions** tab). The site will be at `https://<github-username>.github.io/<repo-name>/`.

### 4. Allow the site's address to sign in

In Firebase: **Authentication → Settings → Authorized domains → Add domain** and add `<github-username>.github.io` (without the `https://` or the repo name).

### 5. First use

1. Open the site and sign in with your `@aiesec.gr` account.
2. Go to **Teams** and click **Add standard AIESEC teams** (or create your own).
3. Add members with their `@aiesec.gr` email. When they sign in, the planner recognises them automatically. Members without an email can pick their name in **I am** once, which links their account.
4. Send the site link to the LC.

---

## Changing the email domain

The domain appears in two places, and they must match:

- `ALLOWED_DOMAIN` in `js/config.js`, which controls what the page shows
- the `matches('.*@aiesec[.]gr$')` line in `firestore.rules`, which controls what the database allows. Re-publish the rules after editing.

This works for Google Workspace accounts. If `@aiesec.gr` mail isn't on Google Workspace, Google sign-in can't be used with it, and the sign-in method needs changing (Firebase supports email-link sign-in).

## Running locally

Any static file server works, for example:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. `localhost` is already an authorized domain in Firebase.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Page shell: sign-in screen and app layout |
| `css/styles.css` | All styles, light and dark theme |
| `js/app.js` | The app: calendar, agendas, teams, Firebase connection |
| `js/config.js` | Firebase project settings and allowed email domain |
| `firestore.rules` | Database security rules (who can read and write) |
| `.github/workflows/pages.yml` | Deploys the site to GitHub Pages on every push to `main` |

## Free plan limits

Firebase's free Spark plan allows 50,000 reads and 20,000 writes per day, plenty for one LC. Nothing is charged unless someone upgrades the plan.
