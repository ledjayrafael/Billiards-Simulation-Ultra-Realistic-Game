import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'blender/**', 'apps/client/public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['tools/**', '**/*.mjs'], rules: { 'no-undef': 'off' } },
  {
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
);
