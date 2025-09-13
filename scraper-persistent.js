require('dotenv').config();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Telenode = require('telenode-js');
const fs = require('fs');
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

const checkIfHasNewItem = (listingUrls, topic) => {
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
    
    return newItems;
};

const scrape = async (topic, url) => {
    const apiToken = process.env.TELEGRAM_API_TOKEN;
    const chatId = process.env.CHAT_ID;
    
    if (!apiToken || !chatId) {
        console.error('❌ Telegram credentials missing. Check GitHub secrets');
        return;
    }
    
    const telenode = new Telenode({ apiToken });
    
    try {
        const allListingUrls = await scrapeWithBrowser(url);
        
        // Check which listings are actually new using compressed data management
        const newListingUrls = checkIfHasNewItem(allListingUrls, topic);
        
        // Always send a message - either about new listings or no new cars found
        const now = new Date();
        const israelTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
        const hour = israelTime.getHours();
        
        // Send notifications during active hours (8 AM to 12 AM) OR for manual testing
        const isActiveHour = hour >= 8 && hour <= 23;
        const isManualTest = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
        
        if (isActiveHour || isManualTest) {
            if (newListingUrls.length > 0) {
                // Send each NEW car listing as a separate Hebrew message
                for (const listingUrl of newListingUrls) {
                    const message = `היי יש לך מודעה חדשה של ${topic}! ${listingUrl}`;
                    await telenode.sendTextMessage(message, chatId);
                    
                    // Small delay between messages to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                console.log(`📱 Sent ${newListingUrls.length} individual notifications for ${topic}`);
                
                // Data is already updated in checkIfHasNewItem function
            } else {
                // Send Hebrew message when no NEW cars found
                const message = `אוי חמודדדד לא נורא אולי נמצא מכונית בעוד שעה`;
                await telenode.sendTextMessage(message, chatId);
                console.log(`📱 Sent "no new cars" notification for ${topic}`);
            }
        } else {
            console.log(`⏰ Not within active hours (${hour}:00) and not manual test, skipping notification`);
            console.log(`📊 Found ${allListingUrls.length} total, ${newListingUrls.length} new for ${topic}`);
            
            // Data is already updated in checkIfHasNewItem function
            if (newListingUrls.length > 0) {
                console.log(`💾 Updated storage with ${newListingUrls.length} new listings for ${topic}`);
            }
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