# openElement brand / openElement 品牌

## Construction rule / 构造规则

Use a 32 × 32 grid with the origin at the upper left, x increasing right, and y
increasing down. Draw the host circle at (16, 16) with a radius of 14. Cut its
upper-right segment along the plane x − y = 14, which meets the circle at
(16, 2) and (30, 16). Close the remaining three-quarter arc with a straight
chord. Set the shadow-root aperture at (14, 18) with a radius of 7. Render the
host and aperture as two closed contours in one path with even-odd fill and
`currentColor`.

使用 32 × 32 的方格，左上角为原点，x 向右递增，y 向下递增。以 (16, 16) 为圆心、
14 为半径绘制宿主圆。沿 x − y = 14 切去右上方的弓形区域，这条直线与圆相交于
(16, 2) 和 (30, 16)。以直线连接两点，将剩余的四分之三圆弧闭合。影子根（shadow root）
开口以 (14, 18) 为圆心、7 为半径。将宿主和开口作为两个闭合轮廓，以奇偶填充规则
绘制在同一条路径中，填充色使用 `currentColor`。

## Derivation / 设计来源

The host contour encloses a separate shadow-root boundary drawn in clear space.
The diagonal face marks the host’s mounting edge. Moving the aperture two units
left and two units down keeps the chord legible and leaves a continuous wall of
at least four grid units, equivalent to about two pixels at favicon size. The
artwork comes entirely from the grid, radii, and offsets specified above.

宿主外轮廓包围以留白表示的独立影子根边界。右上方的斜边表示宿主的安装面。开口向左、
向下各偏移两个单位，凸显斜边，并保留至少四个网格单位的连续边框，在 favicon 尺寸下
约为两个像素。图形完全由上述方格、半径和偏移量生成。

## Assets / 资源

| File / 文件 | Use / 用途 |
| --- | --- |
| `mark.svg` | One transparent, inherited-color mark. / 单路径图形，背景透明，继承前景色。 |
| `lockup.svg` | Mark with a live wordmark. / 图形配合可选中的字标。 |
| `/favicon.svg` | Mark ink follows the browser’s light or dark preference. / 标记颜色随浏览器的明暗偏好切换。 |
| `apple-touch-icon.png` | 180 × 180. Center a 128 × 128 mark on the fixed dark export background. / 180 × 180，在导出资源的固定深色背景上居中放置 128 × 128 的图形。 |
| `og-default.png` | 1200 × 630. Center a 144 × 144 mark and 92 px, weight-800 Inter Variable wordmark with a 28 px gap on the dark ground. / 1200 × 630，在深色背景上居中排列 144 × 144 的图形和 92 像素、800 字重的 Inter Variable 字标，间距 28 像素。 |

The header mark uses `currentColor` to follow the site's foreground, `#151515` in light
mode and `#f2f2f2` in dark mode. The downloadable mark and lockup use
`currentColor` for inline use. The transparent favicon uses its own `#0a0a0a` light and
`#f7f8f8` dark inks. Both PNGs use fixed `#f7f8f8` ink on `#08090a`. The social card
uses the site's Inter Variable font at `-0.04em` letter spacing.

网页页头图形通过 `currentColor` 继承网站前景色，亮色为 `#151515`，暗色为 `#f2f2f2`。
下载的图形和带字标版本通过 `currentColor` 在内联时继承颜色。透明 favicon 自有亮色 `#0a0a0a` 和暗色
`#f7f8f8`。两个 PNG 均为固定的 `#f7f8f8` 前景和 `#08090a` 背景。社交卡片使用网站的
Inter Variable 字体，字距为 `-0.04em`。

Historical assets under `/assets/` retain their existing paths for older links and
repository READMEs. The current website identity uses the assets listed above.

`/assets/` 下的历史资源保留原有路径，供旧链接和仓库 README 继续引用。当前官网使用上表中的品牌资源。
