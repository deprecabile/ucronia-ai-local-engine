// ESLint 9 (flat config) per il backend Node + TypeScript.
// Lint "leggero" non type-checked: i tipi li copre già `tsc --noEmit` (npm run typecheck),
// così il lint resta veloce e non richiede parserOptions.project.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "eslint.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
      // Abilita le regole type-aware: il parser carica i tipi dal tsconfig più vicino.
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Il wrapper dell'Agent SDK (agent.ts) e i parser in turn.ts usano `any`
      // deliberatamente sui messaggi non tipati dell'SDK: vietarlo sarebbe rumore.
      "@typescript-eslint/no-explicit-any": "off",
      // Permetti parametri/var inutilizzati con prefisso _ (es. `_req` in server.ts).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Sicurezza sull'async (richiede il type-checker): in un backend tutto
      // async/Promise.all queste sono il rischio principale che tsc NON cattura.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-for-in-array": "error",
    },
  }
);
