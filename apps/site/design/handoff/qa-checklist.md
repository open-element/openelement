# WWW Cinematic QA Checklist

## Visual and content

- [ ] The 240 committed Chromium baselines (30 routes × two locales × two
      themes × two viewports) preserve `<open/>`, violet depth,
      readable type and a single clear scene per viewport.
- [ ] The homepage begins with real HTML title, lede and CTAs, not a canvas,
      video or loading state.
- [ ] The five-step film accurately shows Element, DSD, islands, portable
      output and the public starter.
- [ ] Docs, API, Architecture and Roadmap use shared expressive short heroes and
      section frames; long
      reading pages stay calm and legible.
- [ ] Guides and articles SSR structured metadata, complete TOCs and deterministic
      previous/next navigation.

## Motion and access

- [ ] Keyboard focus restores the command bar and every link remains usable.
- [ ] Reduced motion has complete static scenes and no hidden information.
- [ ] WebGL unavailable and context-loss paths retain a polished CSS backdrop.
- [ ] Touch, 200% zoom, screen reader labels and theme persistence pass.
- [ ] Missing IntersectionObserver and View Transitions preserve the full static
      information architecture.

## Performance and proof

- [ ] First paint and LCP do not await a client island or WebGL.
- [ ] Atmosphere is lazy, capped for low power and stops when disconnected.
- [ ] No animation causes visible layout shift.
- [ ] Build, truth checks, typecheck, test suite and Chromium/Firefox/WebKit
      browser gates pass before release.
