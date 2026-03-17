import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettierPlugin from 'eslint-plugin-prettier';

const sharedGlobals = {
  ...globals.node,
  ...globals.browser,
  ...globals.worker,
};

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'db',
      'coverage',
      'src/examples/videos',
      '**/*.zip',
      '**/*.mp4',
    ],
  },
  {
    plugins: {
      prettier: prettierPlugin,
    },
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    rules: {
      // Treat Prettier mismatches as errors so formatting issues surface; prefer single quotes
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
        },
      ],
    },
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      sourceType: 'module',
      globals: sharedGlobals,
    },
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: sharedGlobals,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Keep type-aware linting but allow dynamic/any-heavy code paths
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-ignore': 'allow-with-description' },
      ],
    },
  }
);
