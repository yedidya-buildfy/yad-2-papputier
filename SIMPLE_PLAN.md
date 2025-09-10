# 3-Phase Yad2 Crawler Plan

## Phase 1: Setup Browser Automation
**Goal**: Make Puppeteer work with Yad2

```bash
npm install puppeteer
```

**Test Script**:
```javascript
const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({headless: false}); // See what happens
  const page = await browser.newPage();
  await page.goto('https://www.yad2.co.il/vehicles/cars?manufacturer=30&model=10379&year=2008--1&price=-1-10000');
  await page.waitForTimeout(5000); // Wait 5 seconds
  await page.screenshot({path: 'test.png'}); // Take screenshot
  await browser.close();
})();
```

**Success**: Screenshot shows car listings loaded

---

## Phase 2: Extract Car Data
**Goal**: Get list of car image URLs

```javascript
const imageUrls = await page.evaluate(() => {
  const images = document.querySelectorAll('img[src*="vehicle"], img[src*="car"]');
  return Array.from(images).map(img => img.src);
});

console.log('Found', imageUrls.length, 'cars');
```

**Success**: Console shows car image URLs

---

## Phase 3: Add Telegram Notifications
**Goal**: Replace existing scraper logic

1. Copy Puppeteer code into `scraper.js`
2. Replace `getYad2Response()` function
3. Keep existing Telegram and file storage logic
4. Test full workflow

**Success**: Telegram message with new car listings

---

## Each Phase = 1 Day
- **Day 1**: Install Puppeteer, get screenshot working
- **Day 2**: Extract car data successfully  
- **Day 3**: Full integration with Telegram

**Total Time**: 3 days maximum