// Cloudflare Worker entry point. Serves the static UI (index.html, app.js, style.css) through the ASSETS binding
// and the REST API by reusing the handlers in functions/ (same code the Pages Functions version used).
import * as tasksIndex from '../functions/tasks/index.js';
import * as taskById from '../functions/tasks/[id].js';
import * as projectsIndex from '../functions/projects/index.js';
import * as projectById from '../functions/projects/[id].js';

const routes = [
  [/^\/tasks\/?$/, tasksIndex, false],
  [/^\/tasks\/([^/]+)\/?$/, taskById, true],
  [/^\/projects\/?$/, projectsIndex, false],
  [/^\/projects\/([^/]+)\/?$/, projectById, true],
];

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    for (const [re, mod, hasId] of routes) {
      const m = re.exec(pathname);
      if (!m) continue;
      const verb = request.method === 'HEAD' ? 'Get' : request.method[0] + request.method.slice(1).toLowerCase();
      const handler = mod['onRequest' + verb] || mod.onRequest;
      return handler({ request, env, params: hasId ? { id: decodeURIComponent(m[1]) } : {} });
    }
    return env.ASSETS.fetch(request);
  },
};
