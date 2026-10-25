// Categorical series palette for genuinely identity-based chart series
// (directorates, trend lines) that have no existing status meaning - a
// vacancy/application/offer/verification status always uses
// StatusBadge.jsx's STATUS_COLORS instead, never this file, so a status
// renders identically whether it's a badge or a chart segment.
//
// Slot 1 is this app's own brand blue (--color-primary in theme.css)
// rather than a generic default, with slots 2-8 kept from the dataviz
// skill's own validated default ordering (only the hex changed, not the
// order - re-ordering is what the CVD-safety gates are actually sensitive
// to). Re-validated as a set with the brand blue substituted in:
//
//   node scripts/validate_palette.js \
//     "#2596D1,#eb6834,#1baf7a,#eda100,#e87ba4,#008300,#4a3aa7,#e34948" \
//     --mode light --surface "#FFFFFF"
//
//   PASS lightness band, chroma floor, CVD separation (worst adjacent
//   ΔE 9.1), normal-vision floor (worst adjacent ΔE 19.6). WARN: 3 slots
//   (aqua/yellow/magenta, unchanged from the skill's own documented WARN)
//   sit below 3:1 contrast on a white surface - every chart using them
//   ships a legend and/or direct labels per the dataviz skill's relief
//   rule, never color as the only signal.
//
// Recharts needs real hex for SVG fill props, not CSS custom properties,
// hence plain constants rather than theme.css variables.
export const CHART_SERIES = [
  '#2596D1', // 1 blue   - this app's own brand primary
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948'  // 8 red
];

// Chart chrome - recessive grid/axis ink, kept separate from the series
// colors above so a gridline can never be mistaken for a data series.
export const CHART_GRID = '#E4EFF8';   // matches --color-bg-subtle
export const CHART_AXIS_TEXT = '#51606B'; // matches --color-text-muted

// Status fills for charts - the same meaning as theme.css's status tokens
// (green good, red a problem, gold waiting, UCAA blue in hand, grey over),
// one step brighter so a slice or bar reads as a fill rather than as text.
// Ordered and validated so red and green are never neighbours:
//
//   node scripts/validate_palette.js "#1E8A4C,#2596D1,#E0A339,#D64541,#7D8B99"
//
//   PASS CVD separation (worst ΔE 12.1), normal-vision floor (19.6). The
//   grey fails the chroma floor on purpose - it is the neutral "nothing more
//   to do" - and gold sits below 3:1 on white, so every chart using these
//   carries a legend with counts beside it.
export const STATUS_FILL = {
  good: '#1E8A4C',
  info: '#2596D1',
  waiting: '#E0A339',
  bad: '#D64541',
  neutral: '#7D8B99',
  violet: '#6E56CF',
  magenta: '#D0508A'
};
