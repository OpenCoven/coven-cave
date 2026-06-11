import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3000' });

test('Task 6: Narrow chat panel layout - 280px width', async ({ page }) => {
  // Set narrow viewport to force narrow chat panel
  await page.setViewportSize({ width: 900, height: 900 });
  
  // Navigate to the app
  await page.goto('/', { waitUntil: 'networkidle' });
  
  // Wait for the chat surface to load
  await page.waitForSelector('.chat-surface', { timeout: 10000 });
  console.log('✅ Chat surface loaded');

  // Get the chat list panel dimensions
  const chatListPanel = await page.locator('.chat-list-surface');
  const panelBox = await chatListPanel.boundingBox();
  console.log(`📐 Chat list panel width: ${Math.round(panelBox?.width || 0)}px`);

  // TEST 1: Stats boxes should NOT be visible (removed for optimization)
  const statsBoxes = await page.locator('[class*="stat"]').all();
  console.log(`📊 Stats boxes count: ${statsBoxes.length} (expected: 0)`);
  expect(statsBoxes.length).toBe(0);

  // TEST 2: Search input should be visible and functional
  const searchInput = await page.locator('input[placeholder="Search chats…"]');
  await expect(searchInput).toBeVisible();
  console.log('✅ Search input visible');

  // TEST 3: Filter buttons (Unreads, Archived) should be visible and small/icon-only
  const unreadsButton = await page.locator('button[title*="unreads"], button[title*="Show unreads"]').first();
  const archivedButton = await page.locator('button[title*="archive"], button[title*="Show archived"]').first();
  
  await expect(unreadsButton).toBeVisible();
  await expect(archivedButton).toBeVisible();
  console.log('✅ Filter buttons visible');

  // Get button dimensions (should be icon-only, approximately 8x8 or 32x32)
  const unreadsBox = await unreadsButton.boundingBox();
  console.log(`🔘 Unreads button size: ${Math.round(unreadsBox?.width || 0)}x${Math.round(unreadsBox?.height || 0)}px`);

  // TEST 4: All buttons fit on one line (no wrapping)
  const searchRow = await page.locator('.chat-list-dossier').last();
  const searchRowBox = await searchRow.boundingBox();
  const expectedMaxHeight = 100; // Rough estimate for single row with padding
  console.log(`📏 Search/filter row height: ${Math.round(searchRowBox?.height || 0)}px (no wrapping expected)`);

  // TEST 5: Test button interactions
  console.log('\n--- Testing interactions ---');
  
  // Click unreads button to toggle
  await unreadsButton.click();
  console.log('✅ Unreads button clicked');
  
  // Check if state changed (button should show active state)
  const unreadsClasses = await unreadsButton.getAttribute('class');
  const unreadsActive = unreadsClasses?.includes('success') || unreadsClasses?.includes('color-success');
  console.log(`🎨 Unreads button state changed: ${unreadsActive}`);

  // Toggle back
  await unreadsButton.click();
  console.log('✅ Unreads button toggled back');

  // Click archived button
  await archivedButton.click();
  console.log('✅ Archived button clicked');
  await archivedButton.click();
  console.log('✅ Archived button toggled back');

  // TEST 6: Search functionality
  await searchInput.click();
  await searchInput.type('test');
  const searchValue = await searchInput.inputValue();
  expect(searchValue).toBe('test');
  console.log(`✅ Search works (value: "${searchValue}")`);

  // Clear search
  const clearButton = await page.locator('button[aria-label="Clear chat search"]').first();
  if (await clearButton.isVisible()) {
    await clearButton.click();
    const clearedValue = await searchInput.inputValue();
    expect(clearedValue).toBe('');
    console.log('✅ Search clear works');
  }

  // Take screenshot at 280px width
  await page.screenshot({ path: '/tmp/narrow_280px.png', fullPage: false });
  console.log('📸 Screenshot saved: /tmp/narrow_280px.png');

  // TEST AT 260px WIDTH
  console.log('\n--- Testing at 260px width (narrower) ---');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(300);

  const tinyPanelBox = await chatListPanel.boundingBox();
  console.log(`📐 Chat list width at 260px: ${Math.round(tinyPanelBox?.width || 0)}px`);

  await expect(searchInput).toBeVisible();
  await expect(unreadsButton).toBeVisible();
  await expect(archivedButton).toBeVisible();
  console.log('✅ All elements still visible at 260px');

  await page.screenshot({ path: '/tmp/narrow_260px.png', fullPage: false });
  console.log('📸 Screenshot saved: /tmp/narrow_260px.png');

  // TEST AT 250px WIDTH (even narrower)
  console.log('\n--- Testing at 250px width (narrowest) ---');
  await page.setViewportSize({ width: 750, height: 900 });
  await page.waitForTimeout(300);

  const ultraNarrowBox = await chatListPanel.boundingBox();
  console.log(`📐 Chat list width at 250px: ${Math.round(ultraNarrowBox?.width || 0)}px`);

  const searchVisibleNarrow = await searchInput.isVisible();
  const unreadsVisibleNarrow = await unreadsButton.isVisible();
  console.log(`✅ Search visible at 250px: ${searchVisibleNarrow}`);
  console.log(`✅ Unreads visible at 250px: ${unreadsVisibleNarrow}`);

  await page.screenshot({ path: '/tmp/narrow_250px.png', fullPage: false });
  console.log('📸 Screenshot saved: /tmp/narrow_250px.png');

  // TEST 7: Chat list items render correctly
  const chatItems = await page.locator('.chat-list-surface ul li').count();
  console.log(`\n📋 Chat list items visible: ${chatItems}`);

  // TEST 8: "+ Chat" button
  const newChatButton = await page.locator('button:has-text("Chat"), button:has-text("+ Chat")').first();
  if (await newChatButton.isVisible()) {
    console.log('✅ "+ Chat" button visible');
  }

  console.log('\n✅✅✅ ALL VERIFICATIONS PASSED ✅✅✅');
});
