import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';

(async () => {
  let browser;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    
    console.log('Waiting for app to load...');
    await page.waitForTimeout(3000);
    
    // Test at various widths
    const widths = [1400, 900, 700, 500, 350];
    
    for (const width of widths) {
      console.log(`\nTesting at viewport width: ${width}px`);
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(500);
      
      const filename = `/tmp/chat-width-${width}.png`;
      await page.screenshot({ path: filename });
      console.log(`  Screenshot saved: ${filename}`);
    }
    
    console.log('\n✓ Test complete');
    await browser.close();
    
  } catch (err) {
    console.error('✗ Error:', err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
