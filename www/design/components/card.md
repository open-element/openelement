# Card Component Spec

## Purpose

Cards frame repeated items, examples, and small tools. Page sections should not
be styled as cards, and cards should not be nested inside cards.

## Style

| Property   | Value                                                 |
| ---------- | ----------------------------------------------------- |
| Background | `--bg-card`                                           |
| Border     | `--border-size-1` solid `--border`                    |
| Radius     | `--radius-2`                                          |
| Padding    | `--size-4` to `--size-6` depending on density         |
| Shadow     | none, except subtle tokenized elevation when required |

## Variants

| Variant  | Use                                                              |
| -------- | ---------------------------------------------------------------- |
| Standard | Repeated docs entries, proof points, package rows                |
| Artifact | Code, route, package, or terminal panel through `open-lab-panel` |
| Status   | Roadmap and release-state summaries                              |

## Rules

- Hover may change border color, not position.
- Use stable dimensions for repeated grids.
- Do not use decorative top-edge highlights as the main design motif.
- Do not put page sections inside floating cards.
