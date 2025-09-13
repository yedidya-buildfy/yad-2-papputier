const fs = require('fs');

class SimpleDataManager {
    constructor() {
        this.dataFile = './data/listings.json';
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        const dataDir = './data';
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
    }

    loadData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const data = fs.readFileSync(this.dataFile, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.log(`⚠️ Failed to load data: ${error.message}`);
        }

        // Return default structure if file doesn't exist or is corrupted
        return {
            "lastUpdated": null
        };
    }

    saveData(data) {
        try {
            data.lastUpdated = new Date().toISOString();
            
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
            console.log(`💾 Saved simple listings data`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to save data: ${error.message}`);
            return false;
        }
    }

    extractListingIds(urls) {
        return urls.map(url => {
            const idMatch = url.match(/\/item\/([a-z0-9]+)/i);
            return idMatch ? idMatch[1] : 'unknown';
        }).filter(id => id !== 'unknown');
    }

    getProjectData(projectName) {
        const data = this.loadData();
        return data[projectName] || [];
    }

    updateProject(projectName, newListingUrls) {
        const data = this.loadData();
        const newIds = this.extractListingIds(newListingUrls);
        const existingIds = data[projectName] || [];
        
        // Prevent data loss - only ADD new listings, never replace with fewer
        if (newIds.length === 0) {
            console.log(`⚠️ Warning: Found 0 listings for ${projectName}, not updating data (potential scraping failure)`);
            return existingIds; // Return existing data unchanged
        }
        
        if (newIds.length < existingIds.length && existingIds.length > 5) {
            console.log(`⚠️ Warning: Found ${newIds.length} listings vs ${existingIds.length} existing for ${projectName}`);
            console.log(`This could indicate scraping failure. Only adding new listings, keeping existing ones.`);
            
            // Only add genuinely new IDs, keep all existing ones
            const combinedIds = [...existingIds];
            newIds.forEach(id => {
                if (!combinedIds.includes(id)) {
                    combinedIds.push(id);
                }
            });
            
            data[projectName] = combinedIds;
            this.saveData(data);
            return combinedIds;
        }
        
        // Normal case: similar or more listings found, safe to update
        data[projectName] = newIds;
        this.saveData(data);
        return newIds;
    }

    findNewListings(projectName, currentListingUrls) {
        const currentIds = this.extractListingIds(currentListingUrls);
        const lastSeenIds = this.getProjectData(projectName);
        
        // Find IDs that weren't in the last crawl
        const newIds = currentIds.filter(id => !lastSeenIds.includes(id));
        
        // Convert back to URLs for notifications
        const newUrls = currentListingUrls.filter(url => {
            const idMatch = url.match(/\/item\/([a-z0-9]+)/i);
            const id = idMatch ? idMatch[1] : null;
            return id && newIds.includes(id);
        });
        
        console.log(`📊 ${projectName}: ${currentIds.length} total, ${lastSeenIds.length} previously seen, ${newIds.length} new`);
        
        return newUrls;
    }

    isFirstRun(projectName) {
        const projectData = this.getProjectData(projectName);
        return projectData.length === 0;
    }

    getStats() {
        const data = this.loadData();
        const stats = {
            lastUpdate: data.lastUpdated,
            projects: {}
        };

        Object.keys(data).forEach(key => {
            if (key !== 'lastUpdated') {
                stats.projects[key] = {
                    currentListings: data[key] ? data[key].length : 0
                };
            }
        });

        return stats;
    }
}

module.exports = SimpleDataManager;