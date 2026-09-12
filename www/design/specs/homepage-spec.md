# Homepage Spec — The Web, composed.

The homepage is OpenElement's flagship dogfood. The first viewport contains
real HTML: `<open/>`, the title **The Web, composed.**, a short product lede,
published version, `Start building`, and `Watch it unfold`. None depend on
JavaScript.

## Storyboard

1. **Mark** — the canonical `<open/>` mark occupies the violet field.
2. **Element** — the mark flies to navigation and splits into native DOM layers.
3. **DSD** — the camera crosses the Shadow Root boundary.
4. **Compose** — real components reform into an application interface.
5. **Islands** — selected interaction points wake while static DOM remains still.
6. **Output** — the application folds into Browser, Node and Workers, then the starter CTA.

The opening `<open/>` aperture is the visual prologue, not a separate product
claim. Scene content is concise; detailed architecture lives behind real Docs,
API, Architecture and Roadmap links.

## Interaction

- The desktop film uses 6–7 viewport heights, sticky scenes and reversible spatial transforms.
- Native scroll remains authoritative; do not intercept wheels, touch inertia or keyboard scrolling.
- Mobile uses the same narrative in vertical scenes with reduced parallel
  movement.
- `Watch it unfold` anchors scene one. All CTA links remain native anchors.
- WebGL atmosphere is optional; a CSS violet field remains if it does not run.

## Non-negotiable checks

- No screenshots, videos or fake controls replace framework behaviour.
- `prefers-reduced-motion` makes every scene readable without animation.
- The first paint and LCP do not wait for a client island.
- Every scene has meaningful text and a visible keyboard focus path.
