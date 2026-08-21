// Two rules, both earning their place by having caught a real defect.
//
// no-undef found the one that mattered: a change removed a component and left the call to
// it standing, so converting a single file threw ReferenceError and blanked the screen.
// `npm run build` could not see it — esbuild leaves an unknown identifier as a global
// reference and bundles without complaint — and neither could any test, because nothing
// touched App.jsx.
//
// no-unused-vars found the other half of the same accident: two warning components and a
// locale string survived with nothing calling them, so those warnings were invisible.
//
// Deliberately not a whole style ruleset. This is here to catch code that cannot work, not
// to have opinions about formatting.
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  // Scratch probes and one-off harnesses pile up beside the real tests; they are untracked
  // and run-tests.mjs never sees them, so linting them is noise.
  {
    ignores: [
      "dist/**", ".vercel/**",
      "harness_convert.mjs", "gen_report.cjs",
      "test-debug-bens.mjs", "test-diag.mjs", "test-excel.mjs", "test-filename.mjs",
      "test-fixes.mjs", "test-new-b2c.mjs", "test-parser.mjs", "test-realparse.mjs",
    ],
  },
  {
    files: ["src/**/*.{js,jsx}", "lib/**/*.mjs", "api/**/*.js", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: true },
    plugins: { react },
    rules: {
      // Without these, every component used only in JSX reads as unused and the rule is
      // worthless on this file — App itself came up as dead code.
      "react/jsx-uses-vars": "error",
      "react/jsx-uses-react": "error",
      // The rule that catches the actual defect. Plain no-undef does not see a JSX element
      // name as an identifier reference, so deleting a component and leaving <Component />
      // behind passed the linter — it only showed up indirectly, as the component's own
      // children becoming unused. Delete a component together with its children and that
      // signal disappears too, while the build still succeeds and the page still crashes.
      "react/jsx-no-undef": "error",
      "no-undef": "error",
      // Arguments are often there for shape; what matters is a binding nothing reads.
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
];
