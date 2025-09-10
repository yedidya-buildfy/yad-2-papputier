# Yad2 Crawler TODO List

## Phase 1: Setup Browser Automation
- [ ] Install Puppeteer: `npm install puppeteer`
- [ ] Create test script to launch browser
- [ ] Navigate to Yad2 search URL
- [ ] Take screenshot to verify page loads
- [ ] Confirm car listings are visible in screenshot

## Phase 2: Extract Car Data
- [ ] Add wait for listings to load
- [ ] Find correct CSS selectors for car images
- [ ] Extract image URLs using page.evaluate()
- [ ] Test that image URLs are valid
- [ ] Print count of found cars to console

## Phase 3: Integration with Telegram
- [ ] Replace `getYad2Response()` function in scraper.js
- [ ] Update `scrapeItemsAndExtractImgUrls()` to use Puppeteer
- [ ] Keep existing file storage logic (`checkIfHasNewItem()`)
- [ ] Keep existing Telegram notification logic
- [ ] Test full workflow end-to-end
- [ ] Schedule with cron job or GitHub Actions

## Testing Checklist
- [ ] Browser opens and loads Yad2 page
- [ ] Car listings are extracted successfully
- [ ] New cars trigger Telegram notification
- [ ] No duplicate notifications for same cars
- [ ] Script runs without errors

## Deployment
- [ ] Test locally with `node scraper.js`
- [ ] Set up automated scheduling
- [ ] Monitor for any failures