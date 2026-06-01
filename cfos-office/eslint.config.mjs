import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Visual-token guards — Visual Consistency Phase 4 (the lock).
 *
 * The colour epoch put every colour onto tokens defined in globals.css (`:root` +
 * `@theme inline`) and surfaced to TS via the `var()` accessors in `src/lib/tokens.ts`.
 * Radius consolidated onto the named scale: `rounded-control` (8) / `rounded-card` (14) /
 * `rounded-pill` (full). These rules make re-drift a CI failure.
 *
 * Scoped to `src/**` and fire on string + template literals only (NOT comments or JSX
 * text — so merchant codes like "#142" and the "&#9679;" entity are never false-flagged):
 *   - raw hex colours: #abc / #aabbcc / #aabbccdd
 *   - rgb()/rgba() literals
 *   - arbitrary colour utilities: (bg|text|border|ring|fill|stroke|from|to|via)-[#…]
 *   - arbitrary radius rounded-[…] of 4px and up. ≤3px is permitted: no named token exists
 *     below rounded-control(8px), and snapping a 5–6px chart bar to 8px distorts it — the
 *     only ≤3px users are the value-split / month-bar charts.
 *
 * Documented exceptions carry a `// eslint-disable-next-line no-restricted-syntax -- <reason>`
 * (or file/region disable) at the site: brand marks (CFOAvatar, Google logo SVG), html2canvas
 * share-cards (demo-reveal, value-map-summary), the one ChatSheet drop-shadow rgba, and the
 * DB-coupled CATEGORY_COLORS (mirrors `categories.color` — a DB migration, out of scope).
 * Exempt by ignore: the token source (`tokens.ts`), the scoped `(public)/v4` colour island,
 * and test fixtures.
 *
 * NOT enforced — deliberate, tracked as the type/spacing "wave two": `text-[…]` type sizes and
 * spacing brackets (`p-[…]`, `gap-[…]`, …). Those carry paired line-height/tracking or have no
 * var scale; enforcing them now would red-light un-migrated code. See UI-DIRECTION.md.
 */
const visualTokenGuards = {
  name: "cfo/visual-token-guards",
  files: ["src/**/*.{ts,tsx}"],
  ignores: [
    "src/lib/tokens.ts",          // token source — colour is *defined* here
    "src/app/(public)/v4/**",     // scoped landing colour island (bridges to tokens)
    "src/**/__tests__/**",        // test fixtures (e.g. "#142" merchant codes)
    "src/**/*.test.{ts,tsx}",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/#[0-9a-fA-F]{3,8}/]",
        message:
          "Raw hex colour — read from a token (a globals.css var, via @/lib/tokens). A documented exception? add `// eslint-disable-next-line no-restricted-syntax -- <reason>`. See UI-DIRECTION.md §Colour Tokens.",
      },
      {
        selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}/]",
        message:
          "Raw hex colour in a template literal — read from a token (a globals.css var, via @/lib/tokens). See UI-DIRECTION.md §Colour Tokens.",
      },
      {
        selector: "Literal[value=/rgba?\\(/]",
        message:
          "Raw rgb()/rgba() — read from a token (a globals.css var, via @/lib/tokens). See UI-DIRECTION.md §Colour Tokens.",
      },
      {
        selector: "TemplateElement[value.raw=/rgba?\\(/]",
        message:
          "Raw rgb()/rgba() in a template literal — read from a token. See UI-DIRECTION.md §Colour Tokens.",
      },
      {
        selector:
          "Literal[value=/(bg|text|border|ring|fill|stroke|from|to|via)-\\[#/]",
        message:
          "Arbitrary colour utility (e.g. bg-[#…]) — use a token-backed utility (bg-bg-base, text-value-foundation, border-folder-networth, …). See UI-DIRECTION.md §Colour Tokens.",
      },
      {
        selector:
          "TemplateElement[value.raw=/(bg|text|border|ring|fill|stroke|from|to|via)-\\[#/]",
        message:
          "Arbitrary colour utility in a template literal — use a token-backed utility. See UI-DIRECTION.md §Colour Tokens.",
      },
      {
        selector: "Literal[value=/rounded-\\[(?![0-3]px\\])/]",
        message:
          "Arbitrary radius (rounded-[…] of 4px+) — use rounded-control / rounded-card / rounded-pill. (≤3px is allowed for thin chart bars only.) See UI-DIRECTION.md §Spacing & Layout.",
      },
      {
        selector: "TemplateElement[value.raw=/rounded-\\[(?![0-3]px\\])/]",
        message:
          "Arbitrary radius in a template literal — use rounded-control / rounded-card / rounded-pill. See UI-DIRECTION.md §Spacing & Layout.",
      },
    ],
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  visualTokenGuards,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
