# Simple Yad2 Crawler Plan

## Problem
Yad2 now uses dynamic JavaScript loading. Current scraper can't find listings because they load after page renders.

## Simplest Solution: Browser Automation

### Option 1: Puppeteer (Recommended)
```bash
npm install puppeteer
```

**Why Puppeteer?**
- Runs real Chrome browser
- Waits for JavaScript to load content
- Can screenshot for debugging
- Most reliable for dynamic sites

### Simple Architecture

```
1. Launch headless browser
2. Navigate to search URL
3. Wait for listings to load
4. Extract image URLs from loaded content
5. Compare with previous run
6. Send Telegram notification for new items
```

## Updated scraper.js Structure

```javascript
const puppeteer = require('puppeteer');
const Telenode = require('telenode-js');

async function scrapeWithBrowser(url) {
  const browser = await puppeteer.launch({headless: true});
  const page = await browser.newPage();
  
  await page.goto(url);
  await page.waitForSelector('[data-testid="feed-item"]', {timeout: 10000});
  
  const imageUrls = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid="feed-item"] img');
    return Array.from(items).map(img => img.src);
  });
  
  await browser.close();
  return imageUrls;
}
```

## Required Changes

### 1. Update package.json
```json
{
  "dependencies": {
    "cheerio": "^1.0.0-rc.12",
    "telenode-js": "^1.1.5",
    "puppeteer": "^21.0.0"
  }
}
```

### 2. Update scraper.js
- Replace `getYad2Response()` with `scrapeWithBrowser()`
- Update selectors to match new Yad2 structure
- Keep existing Telegram logic

### 3. Alternative Simple Approach
If Puppeteer is too heavy, try:
- Find the API endpoint Yad2 uses
- Make direct HTTP calls to API
- Parse JSON response instead of HTML

## Deployment Considerations

### Local Testing
```bash
npm install puppeteer
node scraper.js
```

### Production
- Use GitHub Actions for scheduling
- Or deploy to cheap VPS with cron job
- Puppeteer works in Docker containers

## Timeline
1. **Day 1**: Install Puppeteer, update scraper logic
2. **Day 2**: Test with your search URL, debug selectors
3. **Day 3**: Deploy and schedule

## Backup Plan
If Puppeteer doesn't work:
1. Use Playwright instead
2. Find Yad2's mobile API endpoints
3. Use simpler RSS/feed if available

---

**Next Step**: Install Puppeteer and modify the existing scraper.js to use browser automation instead of simple HTTP requests.