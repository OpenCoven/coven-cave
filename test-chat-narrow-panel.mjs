import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:3000';

(async () => {
  let browser;
  try {
    console.log('Launching browser...');
    browser = await chromium.launch({ headless: false });  // headless false to see what's happening
    const context = await browser.newContext();
    const page = await context.newPage();
    
    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Set a reasonable desktop size
    await page.setViewportSize({ width: 1600, height: 900 });
    
    console.log('Waiting for app to load...');
    await page.waitForTimeout(3000);
    
    console.log('\n✓ Browser open - manually resize the chat panel to test narrow widths');
    console.log('Looking for the divider between chat list and chat view...');
    
    // Take initial screenshot
    await page.screenshot({ path: '/tmp/chat-initial-1600.png' });
    console.log('Initial screenshot saved: /tmp/chat-initial-1600.png');
    
    // Try to find and drag the resizable panel separator
    // The separator is typically found with .shell-separator or similar classes
    const separators = await page.locator('[class*="separator"]').count();
    console.log(`Found ${separators} separator elements`);
    
    await page.waitForTimeout(5000);
    
  } catch (err) {
    console.error('✗ Error:', err.message);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
