const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    headless: false,
  },
  // Extensions require a single worker — parallel contexts cause flakiness
  workers: 1,
});
