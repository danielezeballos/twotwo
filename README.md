# rosie diary

A quiet, diary-style blog with a two-person admin portal. Two admins can log
in and publish, edit, or delete entries; everyone else just reads.

Built with Express, EJS, and SQLite (via `better-sqlite3`) — no external
database service needed.

## Run it locally

```bash
npm install
cp .env.example .env
# edit .env and set real values for SESSION_SECRET and the two admin accounts
npm start
```

Visit `http://localhost:3000` for the public site, and
`http://localhost:3000/login` to sign in as one of the two admins you set in
`.env`.

The SQLite database file (`data.sqlite`) is created automatically on first
run, and the two admin accounts are seeded from your environment variables
the first time the server boots. Changing the env vars later won't update an
already-seeded account's password — delete `data.sqlite` and restart if you
need to reset everything during development.

## Deploy: GitHub + Railway

**1. Push to GitHub**

```bash
cd loverosiewebsite
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/loverosiewebsite.git
git push -u origin main
```

(`.env` and the `.sqlite` files are already excluded via `.gitignore` — don't
commit real passwords.)

**2. Create the Railway project**

1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. **New Project → Deploy from GitHub repo** → select `loverosiewebsite`.
3. Railway detects the Node app automatically via `package.json` and runs
   `npm install` then `npm start`.

**3. Set environment variables**

In your Railway service, open the **Variables** tab and add:

- `SESSION_SECRET` — any long random string
- `ADMIN1_USERNAME`, `ADMIN1_PASSWORD`, `ADMIN1_NAME`
- `ADMIN2_USERNAME`, `ADMIN2_PASSWORD`, `ADMIN2_NAME`
- `NODE_ENV` = `production`

Railway sets `PORT` itself, so you don't need to add it.

**4. Add a persistent volume (important)**

By default Railway's filesystem is ephemeral, so the SQLite database (posts
and sessions) can be wiped on redeploy. In your service, go to **Settings →
Volumes → New Volume**, mount it at `/data`, then add one more variable:

- `DB_PATH=/data/data.sqlite`

This keeps your blog posts across deploys and restarts.

**5. Deploy**

Railway redeploys automatically on every push to `main`. Once it's live,
Railway gives you a public `*.up.railway.app` URL (you can attach a custom
domain later under **Settings → Networking**).

## Project structure

```
server.js           Express app and routes
db.js                SQLite setup, schema, admin seeding
views/               EJS templates (public pages + admin portal)
public/css/style.css Site styling
```

## Notes

- Only two accounts can ever post — there's no public sign-up, and no route
  to create additional users. To add or change admins, update the env vars
  and reseed (see above).
- Passwords are hashed with bcrypt before being stored; nothing is ever
  saved in plain text.
