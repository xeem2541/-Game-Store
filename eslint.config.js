import js from '@eslint/js';
import globals from 'globals';

// ตรวจโค้ด: npm run lint — ใช้กฎ recommended ของ ESLint (หาบั๊กจริง ไม่บังคับสไตล์การจัดรูปแบบ)
export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'e2e/.tmp/**', 'public/js/vendor/**', 'admin/vendor/**'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // เซิร์ฟเวอร์ สคริปต์ เทส
  { files: ['server/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'e2e/**/*.{js,mjs}', '*.config.js'], languageOptions: { globals: { ...globals.node } } },
  // หน้าเว็บ (ร้านค้า + หลังบ้าน)
  { files: ['public/**/*.js', 'admin/**/*.js'], languageOptions: { globals: { ...globals.browser, __I18N_VERSION__: 'readonly' } } },
  // Chart.js โหลดด้วย <script> แยก (admin/vendor/chart.umd.js)
  { files: ['admin/**/*.js'], languageOptions: { globals: { Chart: 'readonly' } } },
  // theme-init.js รันแบบสคริปต์ธรรมดาใน <head> (ไม่ใช่ module)
  { files: ['public/js/theme-init.js'], languageOptions: { sourceType: 'script' } },
  // e2e: โค้ดใน page.evaluate() รันในเบราว์เซอร์
  { files: ['e2e/**/*.{js,mjs}'], languageOptions: { globals: { ...globals.browser } } },
];
