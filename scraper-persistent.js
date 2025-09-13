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

// Git-based persistence - read from last-seen.json in repo
const getStoredData = () => {
    const filePath = './data/last-seen.json';
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.log(`⚠️ Failed to read last-seen.json: ${e.message}`);
    }
    
    // Return default structure if file doesn't exist or is corrupted
    return {
        "mitsubishi lancer": [],
        "honda civic": [],
        "lastUpdated": null
    };
};

const getStoredListings = (topic) => {
    const data = getStoredData();
    return data[topic] || [];
};

const checkIfHasNewItem = (listingUrls, topic) => {
    const savedUrls = getStoredListings(topic);
    const newItems = [];
    
    listingUrls.forEach(url => {
        if (!savedUrls.includes(url)) {
            newItems.push(url);
        }
    });
    
    console.log(`📊 Found ${listingUrls.length} total, ${savedUrls.length} previously seen, ${newItems.length} new for ${topic}`);
    
    return newItems;
};

// Save updated listings back to git file
const saveStoredData = (data) => {
    const filePath = './data/last-seen.json';
    try {
        // Ensure data directory exists
        const dir = './data';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Add timestamp
        data.lastUpdated = new Date().toISOString();
        
        // Write to file with pretty formatting
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        console.log(`💾 Saved listings data to ${filePath}`);
        return true;
    } catch (e) {
        console.error(`❌ Failed to save listings data: ${e.message}`);
        return false;
    }
};

const updateStoredListings = (topic, newUrls) => {
    const data = getStoredData();
    
    // Add new URLs to existing ones (avoid duplicates)
    if (!data[topic]) {
        data[topic] = [];
    }
    
    newUrls.forEach(url => {
        if (!data[topic].includes(url)) {
            data[topic].push(url);
        }
    });
    
    // Keep only last 50 URLs per topic to prevent file from growing too large
    if (data[topic].length > 50) {
        data[topic] = data[topic].slice(-50);
    }
    
    return saveStoredData(data);
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
        const allListingUrls = await scrapeWithBrowser(url);
        
        // Check which listings are actually new using git-based persistence
        const newListingUrls = checkIfHasNewItem(allListingUrls, topic);
        
        // Always send a message - either about new listings or no new cars found
        const now = new Date();
        const israelTime = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Jerusalem"}));
        const hour = israelTime.getHours();
        
        // Send notifications during peak hours (9 AM, 1 PM, 6 PM, 10 PM) OR for manual testing
        const peakHours = [9, 13, 18, 22];
        const isManualTest = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
        
        if (peakHours.includes(hour) || isManualTest) {
            if (newListingUrls.length > 0) {
                // Send each NEW car listing as a separate Hebrew message
                for (const listingUrl of newListingUrls.slice(0, 10)) { // Limit to first 10 to avoid spam
                    const message = `היי יש לך מודעה חדשה של ${topic}! ${listingUrl}`;
                    await telenode.sendTextMessage(message, chatId);
                    
                    // Small delay between messages to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                console.log(`📱 Sent ${Math.min(newListingUrls.length, 10)} individual notifications for ${topic}`);
                
                // If more than 10 new listings, send summary of remaining
                if (newListingUrls.length > 10) {
                    const summaryMessage = `יש לך עוד ${newListingUrls.length - 10} מודעות חדשות נוספות של ${topic}!`;
                    await telenode.sendTextMessage(summaryMessage, chatId);
                }
                
                // Update stored listings with all current URLs (including new ones)
                updateStoredListings(topic, allListingUrls);
            } else {
                // Send Hebrew message when no NEW cars found (different from before!)
                const message = `🚗 סריקה של ${topic}: אין רכבים חדשים`;
                await telenode.sendTextMessage(message, chatId);
                console.log(`📱 Sent "no new cars" notification for ${topic}`);
            }
        } else {
            console.log(`⏰ Not a peak hour (${hour}:00) and not manual test, skipping notification`);
            console.log(`📊 Found ${allListingUrls.length} total, ${newListingUrls.length} new for ${topic}`);
            
            // Even during non-peak hours, update storage for new listings found
            if (newListingUrls.length > 0) {
                updateStoredListings(topic, allListingUrls);
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