# Cinematic Motion and QA Spec

## Capability ladder

| Level      | Behaviour                                                                           |
| ---------- | ----------------------------------------------------------------------------------- |
| Static     | Full content, CSS composition, native links and no moving requirements.             |
| Enhanced   | CSS/WAAPI and scroll-linked scene accents when supported.                           |
| Atmosphere | Lazy WebGL violet field only after the first paint and only when motion is allowed. |

The page must remain complete at every lower level. WebGL context loss cancels
the field and exposes the same CSS background without a user-visible error.

## Runtime rules

- Use one scene coordinator per page; route content must not scatter scroll
  listeners or call WebGL directly.
- The Hero mark and navigation mark share `open-brand-mark` view-transition
  identity. The navigation link always resolves to the current locale home.
- Use `ResizeObserver` for canvas sizing, cap backing scale at 1.5 and request
  `low-power` WebGL. Stop animation when disconnected or context is lost.
- Device pressure may reduce visual density but never hide product text.
- `prefers-reduced-motion: reduce` disables continuous animation and keeps
  scenes in their final readable composition.

## Acceptance matrix

Validate desktop and mobile in dark/light modes for homepage, Docs, API,
Architecture, Roadmap, Blog, a guide and 404. Verify focus, 200% zoom, touch,
theme persistence, WebGL unavailable/context loss, reduced motion, no CLS,
LCP without island dependency, and the existing cross-browser E2E suite.
