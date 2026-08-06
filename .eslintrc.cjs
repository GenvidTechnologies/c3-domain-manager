module.exports = {
  root: true,
  // Never lint fixture content: the canonical C3 project materialized under
  // test/fixtures/ ships editor-generated code (ts-defs/*.d.ts) that uses `var`
  // and `Function`, which our rules forbid. `lint` runs with --max-warnings 0.
  ignorePatterns: ["test/fixtures/"],
  parser: "@typescript-eslint/parser",
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  env: { es6: true, node: true },
  rules: {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
};
