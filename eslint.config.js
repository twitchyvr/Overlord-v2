import globals from 'globals';

export default [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/'],
  },
];
