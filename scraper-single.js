require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Telenode = require('telenode-js');
const fs = require('fs');

// Add stealth plugin
puppeteer.use(StealthPlugin());

// Load config
let config;
try {
    config = require('./config.json');
} catch (e) {
    console.error('Config file not found. Please create config.json');
    process.exit(1);
}

const scrapeWithBrowser = async (url) => {
    console.log(`🚀 Launching browser for: ${url}`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=VizDisplayCompositor',
            '--disable-web-security',
            '--disable-features=translate',
            '--disable-ipc-flooding-protection'
        ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport to look like a real browser
    await page.setViewport({
        width: 1366,
        height: 768,
        deviceScaleFactor: 1
    });
    
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Hide automation indicators
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
    });
    
    // Add some randomness to look human
    await page.evaluateOnNewDocument(() => {
        window.chrome = {
            runtime: {}
        };
    });
    
    try {
        // Add random delay before navigation (1-3 seconds)
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        // Navigate to page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Wait for page to fully load with random delay (3-7 seconds)
        await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 4000));
        
        // Simulate human behavior - scroll a bit
        await page.evaluate(() => {
            window.scrollTo(0, Math.random() * 500);
        });
        
        // Another small random delay
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
        console.log('⏳ Waiting for content to load...');
        
        // Try to wait for images, but continue if timeout
        await page.waitForFunction(() => {
            const images = document.querySelectorAll('img');
            return images.length > 5; // Wait for at least some images
        }, { timeout: 10000 }).catch(() => {
            console.log('⚠️  Timeout waiting for images, proceeding anyway...');
        });
        
        // Extract listing links - try multiple strategies
        const listingData = await page.evaluate(() => {
            let listings = [];
            
            // Strategy 1: Look for listing links with common selectors
            const linkSelectors = [
                'a[href*="/vehicles/item/"]',
                'a[href*="/item/"]', 
                'a[href*="vehicle"]',
                '[data-testid*="item"] a',
                '[data-testid*="listing"] a',
                '.feeditem a',
                '.listing a'
            ];
            
            for (const selector of linkSelectors) {
                const links = document.querySelectorAll(selector);
                links.forEach(link => {
                    const href = link.href;
                    if (href && href.includes('yad2.co.il') && !href.includes('#') && !listings.includes(href)) {
                        listings.push(href);
                    }
                });
                
                if (listings.length > 0) {
                    console.log(`Found ${listings.length} listings with selector: ${selector}`);
                    break;
                }
            }
            
            // Strategy 2: If no specific listings found, look for any yad2 links
            if (listings.length === 0) {
                const allLinks = document.querySelectorAll('a[href*="yad2.co.il"]');
                allLinks.forEach(link => {
                    const href = link.href;
                    if (href && 
                        href.includes('/vehicles/') && 
                        !href.includes('/cars?') && 
                        !href.includes('#') &&
                        !listings.includes(href)) {
                        listings.push(href);
                    }
                });
                console.log(`Found ${listings.length} generic vehicle links`);
            }
            
            return [...new Set(listings)]; // Remove duplicates
        });
        
        await browser.close();
        console.log(`✅ Found ${listingData.length} car listings`);
        return listingData;
        
    } catch (error) {
        await browser.close();
        throw error;
    }
};

const checkIfHasNewItem = async (listingUrls, topic) => {
    const filePath = `./data/${topic}.json`;
    let savedUrls = [];
    
    // Create data directory if it doesn't exist
    if (!fs.existsSync('./data')) {
        fs.mkdirSync('./data');
    }
    
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        savedUrls = JSON.parse(data);
    } catch (e) {
        // File doesn't exist, create it
        fs.writeFileSync(filePath, '[]');
        savedUrls = [];
    }
    
    const newItems = [];
    
    listingUrls.forEach(url => {
        if (!savedUrls.includes(url)) {
            savedUrls.push(url);
            newItems.push(url);
        }
    });
    
    // Save updated list
    if (newItems.length > 0) {
        fs.writeFileSync(filePath, JSON.stringify(savedUrls, null, 2));
    }
    
    return newItems;
};

const scrape = async (topic, url) => {
    const apiToken = process.env.TELEGRAM_API_TOKEN || config.telegramApiToken;
    const chatId = process.env.CHAT_ID || config.chatId;
    
    if (!apiToken || !chatId) {
        console.error('❌ Telegram credentials missing. Check GitHub secrets');
        return;
    }
    
    const telenode = new Telenode({ apiToken });
    
    try {
        const listingUrls = await scrapeWithBrowser(url);
        const newItems = await checkIfHasNewItem(listingUrls, topic);
        
        if (newItems.length > 0) {
            // Send Hebrew message for each new listing
            for (const listingUrl of newItems.slice(0, 10)) { // Limit to first 10 to avoid spam
                const message = `היי יש לך מודעה חדשה! ${listingUrl}`;
                await telenode.sendTextMessage(message, chatId);
                
                // Small delay between messages to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            console.log(`📱 Sent ${Math.min(newItems.length, 10)} Hebrew notifications`);
            
            // If more than 10, send summary
            if (newItems.length > 10) {
                const summaryMessage = `יש לך עוד ${newItems.length - 10} מודעות חדשות!`;
                await telenode.sendTextMessage(summaryMessage, chatId);
            }
        } else {
            console.log('👌 No new listings found');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await telenode.sendTextMessage(`🚨 Scraper failed: ${error.message}`, chatId);
    }
};

const runScan = async () => {
    console.log('🎯 Running GitHub Actions scan...');
    
    const projects = config.projects.filter(project => !project.disabled);
    
    for (const project of projects) {
        console.log(`📋 Processing: ${project.topic}`);
        await scrape(project.topic, project.url);
    }
    
    console.log('✅ GitHub Actions scan completed!');
};

// Run single scan (for GitHub Actions)
runScan().catch(console.error);