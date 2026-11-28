---
name: FH-MUM NJF Hotel Accommodation Planner
description: "Group tags: every tour is a luggage tag whose colour follows it across nights, rooms and messages."
colors:
  rail: "oklch(41% 0.19 272)"
  rail-deep: "oklch(33% 0.17 272)"
  rail-ink: "oklch(100% 0 0)"
  rail-ink-2: "oklch(87% 0.06 272)"
  rail-line: "oklch(100% 0 0 / 0.3)"
  rail-wash: "oklch(100% 0 0 / 0.13)"
  ruya: "oklch(57% 0.115 185)"
  ruya-soft: "oklch(93.5% 0.045 185)"
  ruya-ink: "oklch(35% 0.08 185)"
  araf: "oklch(77% 0.155 78)"
  araf-soft: "oklch(94.5% 0.06 88)"
  araf-ink: "oklch(40% 0.09 70)"
  c: "oklch(58% 0.2 8)"
  c-soft: "oklch(94.5% 0.035 8)"
  c-ink: "oklch(40% 0.15 8)"
  tag-bg: "oklch(90.5% 0.08 272)"
  tag-line: "oklch(72% 0.125 272)"
  tag-ink: "oklch(29% 0.125 272)"
  info-soft: "oklch(95% 0.03 272)"
  info-line: "oklch(84% 0.07 272)"
  bad: "oklch(55% 0.2 27)"
  bad-soft: "oklch(95.5% 0.03 27)"
  bad-ink: "oklch(43% 0.17 27)"
  caution: "oklch(62% 0.17 50)"
  ok: "oklch(52% 0.14 152)"
  canvas: "oklch(97.3% 0.008 272)"
  surface: "oklch(100% 0 0)"
  sunk: "oklch(95.6% 0.011 272)"
  line: "oklch(90.5% 0.014 272)"
  line-strong: "oklch(81% 0.022 272)"
  control: "oklch(63% 0.03 272)"
  caution-soft: "oklch(95% 0.045 60)"
  caution-ink: "oklch(42% 0.11 50)"
  ink: "oklch(23% 0.045 272)"
  ink-2: "oklch(42% 0.035 272)"
  ink-3: "oklch(51% 0.03 272)"
  scrim: "oklch(23% 0.045 272 / 0.4)"
  shadow: "oklch(23% 0.045 272 / 0.18)"
typography:
  display: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.005em", fontVariation: "'wdth' 84" }
  headline: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.45, letterSpacing: "-0.005em", fontVariation: "'wdth' 84" }
  title: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "1rem", fontWeight: 700, lineHeight: 1.45 }
  body: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "0.875rem", fontWeight: 400, lineHeight: 1.45 }
  table: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.45 }
  label: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "0.8125rem", fontWeight: 600, lineHeight: 1.45 }
  caption: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "0.75rem", fontWeight: 600, lineHeight: 1.3 }
  tag: { fontFamily: "'Archivo Variable', 'Archivo', ui-sans-serif, system-ui, sans-serif", fontSize: "0.8125rem", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.005em", fontVariation: "'wdth' 84" }
  mono: { fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace", fontSize: "0.75rem", fontWeight: 400, lineHeight: 1.6 }
rounded:
  r-1: "5px"
  r-2: "8px"
  r-3: "12px"
  tray: "10px"
  cell: "7px"
spacing:
  gutter: "24px"
  gutter-narrow: "16px"
  block: "32px"
  panel: "20px"
  cell-x: "12px"
  cell-y: "8px"
  gap: "8px"
components:
  button: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.label}", rounded: "{rounded.r-2}", height: "34px", padding: "0 12px" }
  button-hover: { backgroundColor: "{colors.sunk}" }
  button-primary: { backgroundColor: "{colors.rail}", textColor: "{colors.rail-ink}", rounded: "{rounded.r-2}", height: "34px", padding: "0 12px" }
  button-primary-hover: { backgroundColor: "{colors.rail-deep}" }
  button-on-rail: { backgroundColor: "{colors.rail}", textColor: "{colors.rail-ink}", rounded: "{rounded.r-2}", height: "34px" }
  button-ghost: { textColor: "{colors.ink-2}", rounded: "{rounded.r-2}", height: "34px" }
  button-sm: { typography: "{typography.caption}", height: "28px", padding: "0 9px" }
  button-lg: { typography: "{typography.body}", height: "40px", padding: "0 16px" }
  input: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.body}", rounded: "{rounded.r-2}", height: "34px", padding: "0 10px" }
  segmented: { backgroundColor: "{colors.sunk}", textColor: "{colors.ink-2}", rounded: "{rounded.tray}", padding: "3px" }
  segmented-selected: { backgroundColor: "{colors.surface}", textColor: "{colors.rail}", rounded: "{rounded.cell}", height: "28px" }
  rail-tab-current: { backgroundColor: "{colors.rail-ink}", textColor: "{colors.rail-deep}", rounded: "{rounded.cell}", height: "32px", padding: "0 13px" }
  tour-tag: { backgroundColor: "{colors.tag-bg}", textColor: "{colors.tag-ink}", typography: "{typography.tag}", height: "22px", padding: "0 8px 0 6px" }
  stay-bar: { backgroundColor: "{colors.tag-bg}", textColor: "{colors.tag-ink}", typography: "{typography.caption}", height: "22px", padding: "0 6px 0 5px" }
  hotel-chip-ruya: { backgroundColor: "{colors.ruya-soft}", textColor: "{colors.ruya-ink}", typography: "{typography.caption}", rounded: "{rounded.r-1}", height: "22px" }
  hotel-chip-araf: { backgroundColor: "{colors.araf-soft}", textColor: "{colors.araf-ink}", typography: "{typography.caption}", rounded: "{rounded.r-1}", height: "22px" }
  hotel-chip-c: { backgroundColor: "{colors.c-soft}", textColor: "{colors.c-ink}", typography: "{typography.caption}", rounded: "{rounded.r-1}", height: "22px" }
  flag-changed: { backgroundColor: "{colors.info-soft}", textColor: "{colors.rail}", typography: "{typography.caption}", padding: "1px 6px" }
  notice: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", typography: "{typography.table}", rounded: "{rounded.r-2}", padding: "10px 12px" }
  notice-bad: { backgroundColor: "{colors.bad-soft}", textColor: "{colors.bad-ink}" }
  table-header: { backgroundColor: "{colors.sunk}", textColor: "{colors.ink-2}", typography: "{typography.caption}", padding: "8px 12px" }
  panel: { backgroundColor: "{colors.surface}", rounded: "{rounded.r-3}" }
---

# Design System: FH-MUM NJF Hotel Accommodation Planner

## Overview

**Creative North Star: "Group Tags"**

The look comes from the colour-coded lanyards and luggage tags a ziyarat group carries. Every tour is a tag: a tinted pill with a punched hole and bold narrow lettering. The plan is read by following a tag's colour across the changes list, the nightly tables, the rooms-by-night board, the room picker and the hotel messages. The owner chose this direction; it replaced the previous look entirely.

The page is bright and flat: white surfaces on a faintly blue canvas, one ultramarine rail across the top, and thin lines instead of shadows. It is a working tool (surface mode: Operate) used mostly on a laptop or desktop, so density is high and the first screen is the plan itself: summary line, NKERP changes, then the occupancy chart. It does not open on a row of same-size stat cards or a dark splash.

**Key Characteristics:**
- One strong colour for the frame (the rail); colour elsewhere always means a tour, a hotel or a state.
- Twelve tag hues, one per tour, the same on every screen.
- Three hotel data colours in the order the hotels fill: teal, amber, raspberry.
- One type family in two widths; six sizes; tabular numerals everywhere.
- Flat tonal layering; shadows only on the side panel and as state feedback.
- Colour transitions only. Movement is limited to panels, disclosures and the pull progress.

## Colors

All colours are OKLCH custom properties on `:root`, with neutrals tinted toward the rail hue (272). Component rules use tokens; the only computed colours are the three tag values, built from a `--h` hue.

### Primary
- **Ultramarine Rail** (`rail`): the top rail, primary buttons, links, focus rings and the selected segment. `info` is an alias of it.
- **Deep Ultramarine** (`rail-deep`): primary hover, the current rail tab's text, the changes-list heading.
- **Rail Inks** (`rail-ink`, `rail-ink-2`, `rail-line`, `rail-wash`): text, secondary text, button outline and hover wash on the rail only.

### Secondary: the three hotels
- **Ruya Teal** (`ruya`, `ruya-soft`, `ruya-ink`): the first hotel, filled room by room.
- **Araf Amber** (`araf`, `araf-soft`, `araf-ink`): the second hotel, a bed count.
- **Hotel C Raspberry** (`c`, `c-soft`, `c-ink`): the third hotel, no limit.

Each has a solid for chart fills and 8px square dots, a soft tint for cells and chips, and an ink for text on the tint. Elements take them through `data-hotel`.

### Tertiary: tags and states
- **Tag tint, line and ink** (`tag-bg`, `tag-line`, `tag-ink`): one lightness and chroma recipe applied to twelve hues 30 degrees apart (15, 45, 75 and so on to 345). The frontmatter shows the fallback hue.
- **Changed Wash and Line** (`info-soft`, `info-line`): rows, flags and the changes list for anything NKERP changed.
- **Problem Red** (`bad`, `bad-soft`, `bad-ink`): overbooking, a room request that cannot be met, a failed pull, low free beds.
- **Caution Orange** (`caution`): the icon only, on neutral notices.
- **Done Green** (`ok`): finished pull steps, a copied message, the all-clear tick.

### Neutral
- **Blue-White Canvas** (`canvas`) under **White** (`surface`) panels; **Sunk** (`sunk`) for table headers, trays and expanded detail.
- **Line** and **Strong Line** (`line`, `line-strong`): dividers and panel edges.
- **Control** (`control`): the outline of inputs, selects and buttons, at least 3:1 against white.
- **Caution** (`caution`, `caution-soft`, `caution-ink`): sample data and other cautions. Never the Araf amber.
- **Ink, Ink 2, Ink 3** (`ink`, `ink-2`, `ink-3`): text, supporting text, quietest text. All three pass 4.5:1 on canvas, surface, sunk and the changed wash.

### Named Rules
**The Tag Follows the Tour Rule.** Hues are assigned once, from every tour pulled for either city (`assignHues` in `src/lib/tags.ts`), and read with `useHue()`, so a tour has one colour on every tab. Tours whose dates overlap do not share a hue while hues remain. Never assign a tag colour by position, hotel or status.

**The Hotels Are Data Rule.** Hotel colours mark hotels only; tag colours mark tours only. They share hues, so form separates them: a tag is a pill with a punched hole, a hotel is a square dot, a flat chip or a chart fill.

**The Blue Changed, Red Problem Rule.** Blue wash means NKERP changed it. Red means the plan cannot work as it stands. Nothing else uses either.

**The Neutral Caution Rule.** A caution is a white notice with an orange icon, never an amber fill, so it cannot be read as the amber hotel.

## Typography

**Display and body font:** Archivo Variable (width axis, via `@fontsource-variable/archivo/wdth.css`), falling back to Archivo, then system sans.
**Mono font:** the system monospace stack, for hotel message text and inline codes.

**Character:** One family in two widths. Normal width carries reading text; 84% width at weight 700 (`font-stretch: 84%`) is the lettering on a tag and is used for headings, tour tags and big numerals.

### Hierarchy
- **Display** (700, 84% width, 1.75rem, 1.1): hotel totals, the pull tally and the pull screen heading.
- **Headline** (700, 84% width, 1.25rem): page-bar title, section headings, panel titles.
- **Title** (700, normal width, 1rem): hotel names in the summary, settings and message-day headings. The summary line is 1rem regular in Ink 2.
- **Body** (400, 0.875rem, 1.45): page default and field text.
- **Table** (400, 0.8125rem): table cells, list rows, notices. Buttons, tabs and field labels use this size at 600.
- **Caption** (0.75rem): table headers at 600, notes, counts, chart axes.
- **Tag** (700, 84% width, 0.8125rem, line-height 1): tour numbers.
- **Mono** (0.75rem, 1.6): message text, pre-wrapped.

### Named Rules
**The Six Sizes Rule.** Type uses `--fs-1` to `--fs-6` (0.75, 0.8125, 0.875, 1, 1.25, 1.75rem). Nothing is set below 0.75rem (12px).

**The Two Widths Rule.** Narrow bold is for headings, tags and numerals that are read as figures. Sentences stay at normal width.

## Layout

A full-width rail (not sticky, 60px min) holds the name, the three tabs, the pull status, the pull button and settings. Under it a sticky page bar (56px, `--bar-h`) holds the title, section links with counts, and the page's actions with one primary. Content sits in a 1440px column with a 24px gutter. Sections are stacked blocks 32px apart, each with a heading row and one white panel or table.

Spacing is literal values on a 4px-based rhythm (4, 6, 8, 10, 12, 16, 20, 24, 32). Only the gutter, bar height and page width are tokens. Table cells are 8px by 12px; the daily and capacity tables tighten to 5px vertical.

- **Up to 1180px:** gutter drops to 16px, the page bar wraps, wide tables and the room board scroll inside their own frame.
- **Up to 760px:** the page bar stops being sticky, three-up summaries stack, and tables marked `stack` become one card per row with each cell labelled from `data-label`.
- **Touch (`pointer: coarse`):** buttons, tabs, section links, inputs and text links are at least 44px tall.

### Named Rules
**The Header Under the Bar Rule.** Above 1180px every table header and the room board's date row stick directly under the page bar (`top: var(--bar-h)`); inside a side panel they stick to the panel top.

**The Notes Stay On Screen Rule.** Warnings and NKERP changes live in the row's Notes column. The groups table uses a fixed layout so that column fits without sideways scrolling at desktop width; on a phone the note spans the full card.

## Elevation & Depth

Flat. Depth is tonal: canvas, then white panels with a 1px line, then sunk grey for headers and opened detail. There is no resting shadow on any card, panel or button.

### Shadow Vocabulary
- **Side panel** (`-18px 0 48px -18px var(--shadow)`): the drawer over a scrim.
- **Selected segment** (`0 1px 2px var(--shadow)`): the raised pill in a segmented control.
- **Stay bar hover** (`0 2px 6px -2px var(--shadow)`): feedback on a clickable bar.
- **Field focus** (`0 0 0 3px var(--info-soft)` with a rail border): inputs and selects.

### Named Rules
**The Flat Page Rule.** A shadow is a response to state or an overlay. Panels are separated by lines and tone.

## Shapes

Three radii: 5px (chips, small marks), 8px (buttons, inputs, notices, nested cards), 12px (panels, tables, the changes list). Trays that hold a row of choices are 10px with 7px cells inside; room tiles and pull-day cells are also 7px. These two are literal values, not tokens.

The signature silhouette is the tag: 22px tall, radius `11px 5px 5px 11px`, with a 6px white hole ringed in the tag line colour at the rounded end. Hotels use an 8px square dot (2px radius). Borders are 1px; dashed means left out or empty, a diagonal hatch means held or proposed.

## Components

### Buttons
- **Shape:** 34px tall, 8px radius, 13px semibold, optional 16px icon. Small is 28px, large is 40px.
- **Default:** white with a Strong Line border; hover sinks to grey. **Primary:** rail fill, one per page bar. **On rail:** transparent with a white outline, white wash on hover. **Ghost:** no border, Ink 2.
- **States:** colour transitions at 150ms; disabled is grey text on sunk; a copy button turns green when done. Focus is a 2px rail outline, white on the rail.
- **Text link:** rail colour, underlined, at least 24px tall.

### Tour tag
The tinted pill described under Shapes, holding the tour number. It leads every row, list item and message that belongs to a tour. A held block that is not a tour ("Nov") is a grey tag.

### Hotel chip
A flat 22px chip in the hotel's soft tint with its square dot and the hotel's current name (hotels can be renamed, so always read the name from settings).

### Stay board (signature)
Rooms down the side, nights across, floor bands between. Each stay is a tag-shaped bar in the tour's colour spanning its nights; clicking it opens the room picker. Held rooms are hatched grey bars; rooms left out of the plan are struck through on a hatched track. Groups in the other two hotels follow as one lane each, with the bar in that hotel's tint and the tour tag as the row label.

### Occupancy chart
One stacked column per night in hotel order (teal at the bottom, then amber, then raspberry) against a dashed line for the first hotel's beds. Totals sit above each column, the legend and a hover readout sit above the plot, and every column has a spoken label. Fridays are set heavier (800) in date headers here and on the board. Hatched teal is proposed guests on the approvals screen. Past 45 nights the totals and weekday letters drop out.

### Tables
White frame, 12px radius, sunk sticky header in caption type, 1px row lines. A changed row is washed blue until marked seen. Hotel columns carry a 3px top stripe in the hotel colour; a cell with guests is bold on the hotel's tint, and the first hotel's cell shows an 8px teal fill meter beside the number. A night row opens in place to the floor-by-floor room tiles (50 by 46px, tinted with the occupying tour's tag colour).

### Inputs and segmented controls
Inputs are 34px, 8px radius, white, with a rail border and soft blue ring on focus. An adjusted pax field is washed blue; a room request that cannot be read is bordered red with the reason beneath. Segmented controls are a sunk tray with a white raised pill for the pressed option, in rail text, with an optional count.

### Notices, flags and empty states
A notice is a white box with an orange alert icon; the red variant is for failures. "Changed in NKERP" is a small blue flag followed by the old value struck through and the new one after an arrow. An empty state is a dashed box with a heading and one sentence; an all-clear is a quiet line with a green tick.

### Navigation and side panels
Rail tabs sit in a translucent tray; the current one is a white pill. Section links in the page bar highlight in blue wash as the page scrolls. Side panels slide in from the right at 500, 680 or 1180px wide, trap focus, close on Escape and return focus to the opener.

### Motion
One ease, `cubic-bezier(0.16, 1, 0.3, 1)`. Colour changes 150ms, chevrons 180ms, a night opening 220ms, the side panel 260ms. Pull-day cells fill over 300ms and totals count to a new value over 500ms. Two loops show work in progress: the saving dot and the active pull step. With reduced motion, loops, reveals, slides and count-ups stop; colour changes stay.

## Do's and Don'ts

### Do:
- **Do** put a tour tag wherever a tour appears, coloured through `useHue()`.
- **Do** list and stack hotels in fill order: Ruya, Araf, Hotel C.
- **Do** add a colour as an OKLCH token on `:root` before using it.
- **Do** put a warning in the row's Notes cell, next to the control that fixes it.
- **Do** keep every control at least 24px tall, and 44px on touch.
- **Do** give each page bar a single primary button.
- **Do** say in the rail whether edits are saved.

### Don't:
- **Don't** open a screen on a row of same-size stat cards or a dark splash; the plan comes first.
- **Don't** use a hotel colour for a tour, a status or a warning, or a tag colour for a hotel.
- **Don't** use blue wash for anything except "changed in NKERP", or red for anything except a problem.
- **Don't** fill a caution with amber or yellow.
- **Don't** add a seventh type size or set text below 12px.
- **Don't** add resting shadows to cards, or motion that is not a state change.
- **Don't** invent a logo, photography or brand marks; none exist.
