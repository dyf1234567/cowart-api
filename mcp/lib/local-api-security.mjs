// The local web client receives a per-process capability in its same-origin HTML.
// Widgets must use MCP, never port-scan for an unrelated HTTP service.
export function authorizeLocalApi(req, token) {
  const host = req.headers.host;
  const port = req.socket.localPort;
  if (!['127.0.0.1', 'localhost', '[::1]'].some((name) => host === `${name}:${port}`)) return false;
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  return req.headers['x-cowart-session'] === token;
}
