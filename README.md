# GTD on Cloudflare (Worker + static assets + D1)

`index.html`, `app.js` and `style.css` are at the project root and are the only files served publicly (see `.assetsignore`).
The API is `src/worker.js`, which routes to the handlers in `functions/`, using a D1 database bound as `DB`.

    src/worker.js                   entry point: routes /tasks and /projects, everything else is served as a static asset
    functions/tasks/*.js            GET/POST /tasks, GET/PATCH/DELETE /tasks/:id
    functions/projects/*.js         GET/POST /projects, GET/PATCH/DELETE /projects/:id (409 while tasks remain; ?force=true unassigns them)
    functions/_lib/api.js           shared validation + error helpers
    migrations/                     0001_init.sql (schema), 0002_seed.sql (3 projects, 8 tasks)

## Run locally
    npm install
    npm run db:local        # local D1 with seed data
    npm run dev             # http://localhost:8788
    npm test                # API tests against http://localhost:8788 (needs a fresh, seeded DB)

## Deploy
Cloudflare dashboard -> Workers & Pages -> Create -> import this GitHub repo.
Deploy command: `npx wrangler deploy` (the default). The Worker name in the dashboard must match `name` in `wrangler.toml` ("gtd").
The D1 database must already contain the tables (run `npm run db:remote`, or paste migrations/*.sql into the D1 console once).
The `database_id` in `wrangler.toml` is the id of your `gtd` database.
