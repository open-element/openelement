/** Middleware and API route server-entry emission. */
import type { ApiRouteDecl, CorsOriginConfig, MiddlewareDecl } from '../protocol/ssg.ts';
import { quoteGeneratedJavaScriptValue } from './codegen-literals.ts';

function renderCorsOrigin(origin: CorsOriginConfig): string {
  if (typeof origin === 'object' && !Array.isArray(origin)) return origin.body;
  if (Array.isArray(origin)) {
    return `[${origin.map((o) => quoteGeneratedJavaScriptValue(o)).join(', ')}]`;
  }
  return quoteGeneratedJavaScriptValue(origin);
}

const CORS_ALLOW =
  "allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'], allowHeaders: ['Content-Type', 'Authorization'], credentials: true, maxAge: 86400";

// The entry is generated twice per process (configResolved placeholder pass
// with empty routes, then buildStart with real routes). Warn once (#925).
let corsOriginWarningShown = false;

// Test-only reset: the flag is process-global by design, tests restore it
// between cases (see entry-renderer.test.ts).
export function resetCorsOriginWarningForTests(): void {
  corsOriginWarningShown = false;
}

export function renderMiddleware(lines: string[], mw: MiddlewareDecl): void {
  if (mw.comment) {
    lines.push(`// ${mw.comment}`);
  }

  switch (mw.kind) {
    case 'requestId':
      lines.push("app.use('*', requestId())");
      break;

    case 'logger':
      lines.push("app.use('*', honoLogger())");
      break;

    case 'cors': {
      const corsOrigin = mw.config?.corsOrigin;
      if (corsOrigin === '*' || (Array.isArray(corsOrigin) && corsOrigin.includes('*'))) {
        throw new Error(
          'CORS misconfiguration: origin "*" with credentials: true is invalid. ' +
            'Specify explicit origin(s) or set credentials: false.',
        );
      }
      if (corsOrigin !== undefined) {
        const originStr = renderCorsOrigin(corsOrigin);
        lines.push(
          `app.use('*', cors({ origin: ${originStr}, ${CORS_ALLOW} }))`,
        );
      } else {
        if (!corsOriginWarningShown) {
          corsOriginWarningShown = true;
          console.warn(
            '[openElement] middleware.corsOrigin is not configured. The generated server only ' +
              'reflects localhost origins; configure middleware.corsOrigin in openElement() before ' +
              'production deployment to avoid unintended cross-origin access.',
          );
        }
        lines.push("app.use('*', cors({ origin: (origin) => {");
        lines.push(
          '  if (origin && /^https?:\\/\\/(localhost|127\\.0\\.0\\.1)(:\\d+)?$/.test(origin)) return origin',
        );
        lines.push('  // In production, set middleware.corsOrigin explicitly');
        lines.push('  return undefined');
        lines.push(`}, ${CORS_ALLOW} }))`);
      }
      break;
    }

    case 'securityHeaders':
      lines.push("app.use('*', secureHeaders())");
      break;

    case 'csp': {
      const cspConfig = mw.config?.csp;
      if (cspConfig) {
        const headerName = cspConfig.reportOnly
          ? 'Content-Security-Policy-Report-Only'
          : 'Content-Security-Policy';
        if (cspConfig.nonce) {
          const basePolicy: string = cspConfig.policy || '';
          const hasScriptSrc = /script-src/i.test(basePolicy);
          const policyTemplate = hasScriptSrc
            ? basePolicy.replace(
              /script-src\s+([^;]*)/i,
              "script-src 'nonce-NONCE_PLACEHOLDER' $1",
            )
            : basePolicy + "; script-src 'nonce-NONCE_PLACEHOLDER'";
          lines.push(
            `// CSP with auto-nonce: generates a per-request nonce and adds it to script tags`,
          );
          lines.push(`app.use('*', async (c, next) => {`);
          lines.push(`  const nonce = crypto.randomUUID().replace(/-/g, '')`);
          lines.push(`  c.set('cspNonce', nonce)`);
          lines.push(
            `  const policy = ${
              quoteGeneratedJavaScriptValue(policyTemplate)
            }.replace('NONCE_PLACEHOLDER', nonce)`,
          );
          lines.push(`  await next()`);
          lines.push(`  c.header('${headerName}', policy)`);
          lines.push(`})`);
        } else {
          lines.push(`app.use('*', async (c, next) => {`);
          lines.push(`  await next()`);
          lines.push(
            `  c.header('${headerName}', ${quoteGeneratedJavaScriptValue(cspConfig.policy ?? '')})`,
          );
          lines.push(`})`);
        }
      }
      break;
    }
  }

  lines.push('');
}

/**
 * Render an API route using Hono's standard app.route().
 */
export function renderApiRoute(lines: string[], route: ApiRouteDecl): void {
  const pathLiteral = quoteGeneratedJavaScriptValue(route.path);
  lines.push(`// API: ${route.path} (${route.filePath})`);
  lines.push(
    `if (${route.varName}.default && typeof ${route.varName}.default.fetch === 'function') {`,
  );
  lines.push(`  app.route(${pathLiteral}, ${route.varName}.default)`);
  lines.push(`} else if (typeof ${route.varName}.default === 'function') {`);
  lines.push(`  app.all(${pathLiteral}, async (c) => {`);
  lines.push(`    return await ${route.varName}.default({`);
  lines.push(`      request: c.req.raw,`);
  lines.push(`      params: c.req.param() || {},`);
  lines.push(`      env: c.env || {},`);
  lines.push(
    `      platform: (() => { try { return c.executionCtx } catch { return undefined } })(),`,
  );
  lines.push(`    })`);
  lines.push(`  })`);
  lines.push(`} else {`);
  lines.push(
    `  throw new Error('API route ' + ${pathLiteral} + ' must default-export a Hono app or a function (ctx) => Response')`,
  );
  lines.push(`}`);
  lines.push('');
}
