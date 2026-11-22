import nextTypeScript from "eslint-config-next/typescript";
import nextConfig from "eslint-config-next";
import prettierConfig from "eslint-config-prettier/flat";
import globals from "globals";

/**
 * Architecture boundaries (docs/ARCHITECTURE.md §1) are enforced statically:
 * UI must not reach into data access, and only repositories talk to SQLite.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "data/**",
      ".test-tmp/**",
      "drizzle/**",
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "next-env.d.ts",
      ".env*",
    ],
  },
  ...nextConfig,
  ...nextTypeScript,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "better-sqlite3",
                "drizzle-orm",
                "@/db/**",
                "**/repository",
                "**/repository/*",
              ],
              message:
                "UI may not access the database directly. Call a service via an API route (docs/ARCHITECTURE.md §1).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.ts", "src/worker/**/*.ts", "tests/**/*.ts", "*.config.ts", "*.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      // Formatting is Prettier's job; ESLint must not fight it.
      ...prettierConfig.rules,
    },
  },
];

export default config;
