import { createOpenElementNitroHandler } from '../../../../src/nitro-mount.ts';
import { openElementHandler } from '../../dist/server/entry.js';

// Nitro v3 is fetch-native: the route event's `req` is already a standard
// Request, so this route is a pure pass-through to the request-time fixture's
// generated server entry. The Workers env is extracted from
// req.runtime.cloudflare.env by the mount itself (nitro-mount.ts, #981).
export default createOpenElementNitroHandler({
  handler: openElementHandler,
});
