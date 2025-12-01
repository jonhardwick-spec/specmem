#!/usr/bin/env node
/**
 * Capture Anthropic ToS Screenshots for Legal Documentation
 * Part of SpecMem's copyright protection - timestamp evidence
 */

const puppeteer = require('puppeteer');
const path = require('path');

const SCREENSHOTS = [
  {
    url: 'https://www.anthropic.com/news/updates-to-our-consumer-terms',
    filename: 'anthropic-tos-screenshot-2026-01-30.png',
    description: 'Consumer Terms Update - Training Opt-Out'
  },
  {
    url: 'https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training',
    filename: 'anthropic-privacy-center-screenshot-2026-01-30.png',
    description: 'Privacy Center - Model Training Policy'
  }
];

async function captureScreenshots() {
  console.log('🔥 Starting screenshot capture for legal documentation...\n');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const legalDir = path.join(__dirname, '..', 'legal');

  for (const shot of SCREENSHOTS) {
    console.log(`📸 Capturing: ${shot.description}`);
    console.log(`   URL: ${shot.url}`);

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      // Add timestamp overlay
      await page.goto(shot.url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait for content to load
      await new Promise(r => setTimeout(r, 2000));

      // Inject timestamp banner at top
      await page.evaluate(() => {
        const banner = document.createElement('div');
        banner.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: #1a1a2e;
          color: #fff;
          padding: 10px 20px;
          font-family: monospace;
          font-size: 14px;
          z-index: 999999;
          border-bottom: 3px solid #e94560;
        `;
        const now = new Date();
        banner.innerHTML = `
          <strong>📋 LEGAL SCREENSHOT - SpecMem Copyright Protection</strong><br>
          <span>URL: ${window.location.href}</span><br>
          <span>Captured: ${now.toISOString()} | ${now.toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</span>
        `;
        document.body.insertBefore(banner, document.body.firstChild);
        document.body.style.paddingTop = '80px';
      });

      const filepath = path.join(legalDir, shot.filename);
      await page.screenshot({ path: filepath, fullPage: true });

      console.log(`   ✅ Saved: ${filepath}\n`);
      await page.close();

    } catch (err) {
      console.error(`   ❌ Failed: ${err.message}\n`);
    }
  }

  await browser.close();
  console.log('🎯 Screenshot capture complete!');
  console.log('   Files saved to: /specmem/legal/');
}

captureScreenshots().catch(console.error);
