import openElementRequestTimeServer from '../../dist/server/index.js';

// Nitro v3 is fetch-native: the route event's `req` is already a standard
// Request. Use the generated request-time server module rather than reaching
// into its raw SSR entry so Node and Workers also share HTML post-processing
// (including the island client-script injection).
export default openElementRequestTimeServer;
