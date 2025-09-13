require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Telenode = require('telenode-js');
const fs = require('fs');
const cron = require('node-cron');
const SimpleDataManager = require('./data-manager');

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
        
        // Extract listing links using winning approach - filter for main feed only
        const listingData = await page.evaluate(() => {
            console.log('🔍 Starting main feed extraction...');
            
            // Use the winning selector that found 57+ links
            const allLinks = document.querySelectorAll('a[data-nagish*="item"]');
            console.log(`Found ${allLinks.length} total links with winning selector`);
            
            let mainFeedResults = [];
            let filteredOut = 0;
            
            allLinks.forEach((link, index) => {
                if (!link.href || !link.href.includes('/item/')) {
                    return;
                }
                
                const url = link.href;
                
                // Filter to only include main feed results (exclude recommendations)
                if (url.includes('component-type=main_feed')) {
                    mainFeedResults.push(url);
                } else if (url.includes('component-type=recommendation') || 
                          url.includes('spot=look_alike') ||
                          url.includes('דגמים_דומים') || 
                          url.includes('recommendation')) {
                    // These are recommendations/suggestions - filter them out
                    filteredOut++;
                } else {
                    // If no clear component-type, check if it's a clean listing URL
                    if (!url.includes('דגמים_דומים') && !url.includes('recommendation')) {
                        mainFeedResults.push(url);
                    } else {
                        filteredOut++;
                    }
                }
            });
            
            // Remove duplicates based on listing ID
            const uniqueMainFeed = [];
            const seenIds = new Set();
            
            mainFeedResults.forEach(url => {
                const idMatch = url.match(/\/item\/([a-z0-9]+)/i);
                const listingId = idMatch ? idMatch[1] : 'unknown';
                
                if (!seenIds.has(listingId)) {
                    seenIds.add(listingId);
                    uniqueMainFeed.push(url);
                }
            });
            
            console.log(`📊 Main feed results: ${uniqueMainFeed.length}, Filtered out: ${filteredOut}`);
            
            return uniqueMainFeed;
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
    const dataManager = new SimpleDataManager();
    
    // Check if this is the first run for this topic
    if (dataManager.isFirstRun(topic)) {
        console.log(`🆕 First run for "${topic}" - bootstrapping ${listingUrls.length} listings without notifications`);
        dataManager.updateProject(topic, listingUrls);
        return []; // No new items for first run
    }
    
    // Find new listings compared to last crawl
    const newItems = dataManager.findNewListings(topic, listingUrls);
    
    // Update the project data with current listings
    dataManager.updateProject(topic, listingUrls);
    
    // Create push flag for workflow if there are new items
    if (newItems.length > 0) {
        fs.writeFileSync("push_me", "");
    }
    
    return newItems;
};

const scrape = async (topic, url) => {
    const apiToken = process.env.TELEGRAM_API_TOKEN;
    const chatId = process.env.CHAT_ID;
    
    if (!apiToken || !chatId) {
        console.error('❌ Telegram credentials missing. Check .env file');
        return;
    }
    
    const telenode = new Telenode({ apiToken });
    
    try {
        const listingUrls = await scrapeWithBrowser(url);
        const newItems = await checkIfHasNewItem(listingUrls, topic);
        
        if (newItems.length > 0) {
            // Send Hebrew message for each new listing
            for (const listingUrl of newItems) {
                const message = `היי יש לך מודעה חדשה! ${listingUrl}`;
                await telenode.sendTextMessage(message, chatId);
                
                // Small delay between messages to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            console.log(`📱 Sent ${newItems.length} Hebrew notifications`);
        } else {
            console.log('👌 No new listings found');
            const noNewCarsMessage = `אוי חמודדדד לא נורא אולי נמצא מכונית בעוד שעה`;
            await telenode.sendTextMessage(noNewCarsMessage, chatId);
            console.log(`📱 Sent "no new cars" message`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        await telenode.sendTextMessage(`🚨 Scraper failed: ${error.message}`, chatId);
    }
};

const runScan = async () => {
    console.log('🎯 Running scheduled scan...');
    
    const projects = config.projects.filter(project => !project.disabled);
    
    for (const project of projects) {
        console.log(`📋 Processing: ${project.topic}`);
        await scrape(project.topic, project.url);
    }
    
    console.log('✅ Scan completed!');
};

const isWithinActiveHours = () => {
    const now = new Date();
    // Convert to Israel time (UTC+2 in winter, UTC+3 in summer)
    const israelTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
    const hour = israelTime.getHours();
    
    // Active between 8 AM (08:00) and 12 AM (00:00 = midnight)
    // This means: 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23
    return hour >= 8 || hour === 0; // 8 AM to 11:59 PM (23:59)
};

const program = async () => {
    console.log('🤖 Yad2 Auto-Scraper Started!');
    console.log('⏰ Scanning every hour between 8 AM - 12 AM (Israel time)');
    console.log('📱 Hebrew notifications will be sent to Telegram');
    console.log('🌙 Scanner sleeps from 12 AM - 8 AM');
    console.log('🔄 Press Ctrl+C to stop\\n');
    
    // Run initial scan if within active hours
    if (isWithinActiveHours()) {
        await runScan();
    } else {
        console.log('😴 Outside active hours (8 AM - 12 AM). Scanner is sleeping...');
    }
    
    // Schedule to run every hour, but only during active hours
    cron.schedule('0 * * * *', async () => {
        if (isWithinActiveHours()) {
            console.log('\\n⏰ Scheduled scan triggered...');
            await runScan();
        } else {
            const now = new Date();
            const israelTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
            const hour = israelTime.getHours();
            console.log(`😴 Sleeping... Current Israel time: ${hour}:${israelTime.getMinutes().toString().padStart(2, '0')} (Active: 8 AM - 12 AM)`);
        }
    }, {
        timezone: "Asia/Jerusalem"
    });
    
    // Keep the process alive
    console.log('🚀 Scheduler is running...');
};

// Run the program
program().catch(console.error);