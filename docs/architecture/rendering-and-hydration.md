# Rendering and hydration

One compiled program is the intended source for server serialization, fresh browser
DOM, and existing-DOM hydration. Hydration preserves observable DOM and user state when the
structure matches and bounds recovery to the owning element when it does not.
Compiler and runtime tests remain deterministic and offline.
