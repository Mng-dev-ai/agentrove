import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'backend-sidecar', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // House style: components are function declarations typed via their signature
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "TSTypeReference > TSQualifiedName[left.name='React'][right.name=/^(FC|FunctionComponent)$/]",
          message: 'Type props via the function signature instead of React.FC.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: ['FC', 'FunctionComponent'],
              message: 'Type props via the function signature instead of FC.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
