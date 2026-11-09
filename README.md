# GTD on Cloudflare Pages (Pages Functions + D1)

`index.html`, `app.js` and `style.css` are at the project root. The API lives in `functions/` and uses a D1 database bound as `DB`.

    functions/tasks/index.js        GET /tasks, POST /tasks
    functions/tasks/[id].js         GET / PATCH / DELETE /tasks/:id
    functions/projects/index.js     GET /projects, POST /projects
    functions/projects/[id].js      GET / PATCH / DELETE /projects/:id  (409 while tasks remain; ?force=true unassigns them)
    functions/_lib/api.js           shared validation + error helpers (not a route)
    migrations/                     0001_init.sql (schema), 0002_seed.sql (3 projects, 8 tasks)

## Run locally
    npm install
    npm run db:local        # creates the local D1 and seeds it
    npm run dev             # http://localhost:8788
    npm test                # API tests against http://localhost:8788 (needs a fresh, seeded DB)

## Deploy
1. `npx wrangler login`
2. `npx wrangler d1 create gtd` -> copy the printed `database_id` into `wrangler.toml`.
3. `npm run db:remote` (applies both migrations to the real database; run it once, the seed would duplicate if re-applied to a reset DB).
4. `npm run deploy` (or connect the repo in the Cloudflare dashboard: no build command, output directory `.`; the D1 binding comes from `wrangler.toml`).
5. Leave Cloudflare Access off so `https://<project>.pages.dev` is public.
6. Check it: `BASE_URL=https://<project>.pages.dev npm test` (the API tests expect the freshly seeded data, so run them before adding your own).

Note: the output directory is `.`, so everything in this folder that isn't a Pages special file is a candidate static asset.
Local `pages dev` serves `wrangler.toml` and `functions/*` as static files. I could not check what a real deploy uploads;
if you want only the three UI files public, move them into a `public/` folder and set `pages_build_output_dir = "public"`.
