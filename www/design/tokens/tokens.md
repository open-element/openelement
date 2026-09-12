# Token Contract

The website uses `openPropsTokenSheet` as the source of truth. Page-level CSS
must not define a separate palette, spacing scale, radius scale, or typography
scale.

## Semantic Tokens

| Role                    | Token              |
| ----------------------- | ------------------ |
| Canvas                  | `--bg-base`        |
| Reading surface         | `--bg-card`        |
| Elevated panel          | `--bg-elevated`    |
| Muted surface           | `--bg-surface`     |
| Hover surface           | `--bg-hover`       |
| Code/artifact panel     | `--bg-code`        |
| Primary text            | `--text-primary`   |
| Secondary text          | `--text-secondary` |
| Muted text              | `--text-muted`     |
| Hairline border         | `--border`         |
| Hover border            | `--border-hover`   |
| Primary action          | `--brand`          |
| Shipped/standards state | `--success`        |
| Planned state           | `--warning`        |
| Reference/API state     | `--info`           |
| Error state             | `--error`          |

## Open Props Scales

| Category       | Required Scale                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Spacing        | `--size-1` through `--size-16`                                                                     |
| Radius         | `--radius-1`, `--radius-2`, `--radius-round`                                                       |
| Font size      | `--font-size-00` through `--font-size-8`                                                           |
| Font weight    | `--font-weight-4` through `--font-weight-9`                                                        |
| Line height    | `--font-lineheight-*`                                                                              |
| Color families | `--gray-*`, `--indigo-*`, `--blue-*`, `--green-*`, `--teal-*`, `--cyan-*`, `--orange-*`, `--red-*` |

## Hardcoding Ban

- No page-level hex, rgb, hsl, or named theme colors.
- No page-level `--space-*`, `--radius-md`, or legacy `--surface-*` scale definitions.
- No `linearTokenSheet` imports in redesigned `www` pages.
- No `*-linear` UI components in redesigned entry pages.
- Literal sizes are allowed only for layout constraints that cannot be expressed
  by Open Props, and those must be rare.
