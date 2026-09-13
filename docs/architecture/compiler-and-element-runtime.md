# Compiler and element runtime

The 1.0 Element baseline uses one mandatory compiler to lower supported TSX into
a Part Program. `OpenElement extends HTMLElement` owns local lifecycle, root, program
instance, subscriptions, and cleanup. Unsupported authoring fails with diagnostics;
it does not fall back to a runtime virtual-DOM path.
