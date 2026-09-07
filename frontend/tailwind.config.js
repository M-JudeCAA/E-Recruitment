export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  // CRITICAL: preflight disabled. Tailwind's base reset changes default
  // margin/padding/border/font styling on plain elements (h1-h6, p, ul,
  // button, etc.) globally - every existing page in this app (HRDashboard,
  // DepartmentAdmin, StaffAdmin, DelegationAdmin, VacancyDetail...) was
  // built assuming ordinary browser defaults plus theme.css, not
  // Tailwind's reset. Leaving preflight on would visually alter every one
  // of those pages the moment Tailwind is added, even though none of them
  // use a single Tailwind class. Disabling it means Tailwind contributes
  // ONLY the utility classes actually written into the wizard's markup
  // (flex, gap, grid, responsive prefixes) and touches nothing else in
  // the app.
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
