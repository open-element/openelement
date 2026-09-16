/**
 * Outer fetch middleware (ADR-0123 item 2, #858). The default export is the
 * result of calling a factory — proof that factory-exported middleware works
 * under the module contract, with the factory closure over LAYER intact.
 * Composed outermost (use[0]): sees the request first, the response last.
 */
import { createLayerMiddleware } from '../lib/middleware-marker.ts';

const LAYER = 'outer';

export default createLayerMiddleware(LAYER);
