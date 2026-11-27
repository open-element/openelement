import type { Middleware } from '@openelement/element';

const privatePages: Middleware = async (request, next) => {
  const response = await next();
  if (/^\/workspaces\/?$/.test(new URL(request.url).pathname)) {
    response.headers.set('cache-control', 'no-store');
  }
  return response;
};

export default privatePages;
