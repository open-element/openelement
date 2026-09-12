# Badge Component Spec

## Purpose

Badges communicate status or category. They are read-only labels, not primary
navigation.

## Style

| Property | Value                                     |
| -------- | ----------------------------------------- |
| Radius   | `--radius-round`                          |
| Height   | `--size-6`                                |
| Padding  | `--badge-padding-y` / `--badge-padding-x` |
| Font     | `--font-size-00` with `--font-mono`       |
| Weight   | `--font-weight-8`                         |

## Variants

| Variant | Background         | Text        |
| ------- | ------------------ | ----------- |
| Current | `--brand-subtle`   | `--brand`   |
| Done    | `--success-subtle` | `--success` |
| Planned | `--warning-subtle` | `--warning` |
| Error   | `--error-subtle`   | `--error`   |

## Rules

- Use sparingly.
- Do not rely on color alone; pair status with readable text.
- Do not turn badges into buttons.
