# Icon Component Spec

## Purpose

Icons are functional aids, not decoration. Use them for tools, status, route
types, and familiar commands.

## Style

| Property | Value                                     |
| -------- | ----------------------------------------- |
| Style    | Outline                                   |
| Stroke   | `--border-size-2` or icon library default |
| Cap/join | Round                                     |
| Fill     | none                                      |
| Color    | currentColor                              |
| Sizes    | `--size-4`, `--size-5`, `--size-6`        |

## Rules

- Use lucide icons when available.
- Use square icon buttons for tools.
- Pair unfamiliar icons with tooltips or visible labels.
- Do not create multi-color icon variants for simple states.
- Use diagrams or product artifacts for hero visuals, not decorative icons.
