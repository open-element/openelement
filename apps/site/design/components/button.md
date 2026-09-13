# Button Component Spec

## Purpose

Buttons should be dense, stable, and easy to scan. Use text buttons for clear
commands and square icon buttons for tools.

## Variants

| Variant   | Background  | Text             | Border      | Use              |
| --------- | ----------- | ---------------- | ----------- | ---------------- |
| Primary   | `--brand`   | `--on-brand`     | `--brand`   | Main action      |
| Secondary | `--bg-card` | `--text-primary` | `--border`  | Secondary action |
| Tertiary  | transparent | `--text-primary` | transparent | Low emphasis     |
| Icon      | `--bg-card` | `--text-primary` | `--border`  | Tool buttons     |

## Rules

- Radius: `--radius-2`.
- Default height: `--size-9` to `--size-10`.
- No pill shape for command buttons.
- No hover translate or decorative shadow.
- Focus-visible uses tokenized brand outline and offset.
- Text must fit without overlap on mobile.
