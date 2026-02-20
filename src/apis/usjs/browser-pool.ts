import { chromium as playwright, Browser, Page } from 'playwright';
import chromium from '@sparticuz/chromium';

interface BrowserInstance {
  browser: Browser;
  page: Page;
  id: string;
  isNavigated: boolean;
  lastUsed: number;
  requestCount: number;
}

export class BrowserPool {
  private pool: BrowserInstance[] = [];
  private maxPoolSize: number;
  private maxRequestsPerBrowser: number;
  private minDelayBetweenRequests: number;
  private maxDelayBetweenRequests: number;
  private lastRequestTimes: Map<string, number> = new Map();
  
  constructor(options: {
    maxPoolSize?: number;
    maxRequestsPerBrowser?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
  } = {}) {
    this.maxPoolSize = options.maxPoolSize || 3; // Conservative pool size
    this.maxRequestsPerBrowser = options.maxRequestsPerBrowser || 10; // Rotate browsers periodically
    this.minDelayBetweenRequests = options.minDelayMs || 2000; // 2 second minimum
    this.maxDelayBetweenRequests = options.maxDelayMs || 5000; // 5 second maximum
  }

  async acquire(): Promise<BrowserInstance> {
    // Clean up stale browsers first
    await this.cleanupStale();
    
    // Find available browser
    let browserInstance = this.findAvailableBrowser();
    
    // Create new browser if none available and under pool limit
    if (!browserInstance && this.pool.length < this.maxPoolSize) {
      browserInstance = await this.createBrowser();
    }
    
    // If still no browser available, wait for one to become available
    if (!browserInstance) {
      browserInstance = await this.waitForAvailableBrowser();
    }
    
    // Apply anti-DDoS delay
    await this.respectfulDelay(browserInstance.id);
    
    return browserInstance;
  }

  private findAvailableBrowser(): BrowserInstance | null {
    return this.pool.find(instance => 
      instance.requestCount < this.maxRequestsPerBrowser &&
      Date.now() - instance.lastUsed > 1000 // At least 1 second since last use
    ) || null;
  }

  private async createBrowser(): Promise<BrowserInstance> {
    const args = process.env.LOCAL ? {} : { 
      executablePath: await chromium.executablePath("/opt/nodejs/node_modules/@sparticuz/chromium/bin") 
    };

    const browser = await playwright.launch({
      args: chromium.args,
      headless: true,
      ...args
    });

    const page = await browser.newPage();
    
    // Set longer timeouts for slower court systems
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);
    
    // Rotate user agents to appear more human-like
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.1 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setExtraHTTPHeaders({
      'User-Agent': randomUserAgent,
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    const browserInstance: BrowserInstance = {
      browser,
      page,
      id: `browser-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      isNavigated: false,
      lastUsed: Date.now(),
      requestCount: 0
    };

    this.pool.push(browserInstance);
    console.log(`🔧 Created new browser instance ${browserInstance.id} (pool size: ${this.pool.length})`);
    
    return browserInstance;
  }

  private async waitForAvailableBrowser(): Promise<BrowserInstance> {
    // Wait for an available browser with exponential backoff
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      const browserInstance = this.findAvailableBrowser();
      if (browserInstance) {
        return browserInstance;
      }
      
      const delay = Math.min(1000 * Math.pow(2, attempts), 10000); // Cap at 10 seconds
      console.log(`⏳ Waiting ${delay}ms for available browser (attempt ${attempts + 1}/${maxAttempts})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempts++;
    }
    
    // Fallback: force create a new browser if all else fails
    console.log('⚠️ Force creating browser due to timeout');
    return await this.createBrowser();
  }

  private async respectfulDelay(browserId: string): Promise<void> {
    const lastRequestTime = this.lastRequestTimes.get(browserId) || 0;
    const timeSinceLastRequest = Date.now() - lastRequestTime;
    
    // Calculate dynamic delay based on recent activity
    const baseDelay = this.minDelayBetweenRequests;
    const randomDelay = Math.random() * (this.maxDelayBetweenRequests - this.minDelayBetweenRequests);
    const requiredDelay = baseDelay + randomDelay;
    
    if (timeSinceLastRequest < requiredDelay) {
      const remainingDelay = requiredDelay - timeSinceLastRequest;
      console.log(`😴 Respectful delay: ${Math.round(remainingDelay)}ms for ${browserId}`);
      await new Promise(resolve => setTimeout(resolve, remainingDelay));
    }
    
    this.lastRequestTimes.set(browserId, Date.now());
  }

  release(browserInstance: BrowserInstance): void {
    browserInstance.lastUsed = Date.now();
    browserInstance.requestCount++;
    
    // If browser has exceeded max requests, mark for cleanup
    if (browserInstance.requestCount >= this.maxRequestsPerBrowser) {
      console.log(`♻️ Browser ${browserInstance.id} reached max requests (${this.maxRequestsPerBrowser}), will be recycled`);
      this.cleanupBrowser(browserInstance);
    }
  }

  async ensureNavigated(browserInstance: BrowserInstance): Promise<void> {
    if (browserInstance.isNavigated) {
      return;
    }

    console.log(`🧭 Navigating ${browserInstance.id} to court search page`);
    
    // Navigate to court search page with retry logic
    let navigationSuccess = false;
    let retryCount = 0;
    const maxRetries = 3;

    while (!navigationSuccess && retryCount < maxRetries) {
      try {
        await browserInstance.page.goto('https://ujsportal.pacourts.us/CaseSearch', { 
          waitUntil: 'networkidle',
          timeout: 45000
        });
        navigationSuccess = true;
        browserInstance.isNavigated = true;
        console.log(`✅ Successfully navigated ${browserInstance.id}`);
      } catch (error) {
        retryCount++;
        console.log(`❌ Navigation attempt ${retryCount} failed for ${browserInstance.id}, retrying...`);
        if (retryCount >= maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000)); // Random backoff
      }
    }
  }

  private async cleanupStale(): Promise<void> {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const staleBrowsers = this.pool.filter(instance => 
      Date.now() - instance.lastUsed > staleThreshold
    );
    
    for (const staleBrowser of staleBrowsers) {
      await this.cleanupBrowser(staleBrowser);
    }
  }

  private async cleanupBrowser(browserInstance: BrowserInstance): Promise<void> {
    try {
      await browserInstance.browser.close();
      console.log(`🗑️ Cleaned up browser ${browserInstance.id}`);
    } catch (error) {
      console.log(`⚠️ Error cleaning up browser ${browserInstance.id}:`, error);
    }
    
    this.pool = this.pool.filter(instance => instance.id !== browserInstance.id);
    this.lastRequestTimes.delete(browserInstance.id);
  }

  async cleanup(): Promise<void> {
    console.log(`🧹 Cleaning up browser pool (${this.pool.length} browsers)`);
    
    const cleanupPromises = this.pool.map(instance => this.cleanupBrowser(instance));
    await Promise.allSettled(cleanupPromises);
    
    this.pool = [];
    this.lastRequestTimes.clear();
    console.log('✅ Browser pool cleanup complete');
  }

  getPoolStatus(): { totalBrowsers: number; availableBrowsers: number; activeBrowsers: number } {
    const available = this.pool.filter(instance => 
      instance.requestCount < this.maxRequestsPerBrowser
    ).length;
    
    return {
      totalBrowsers: this.pool.length,
      availableBrowsers: available,
      activeBrowsers: this.pool.length - available
    };
  }
}

// Singleton instance for the application
export const browserPool = new BrowserPool({
  maxPoolSize: 3,           // Conservative: max 3 concurrent browsers
  maxRequestsPerBrowser: 8, // Rotate browsers every 8 requests
  minDelayMs: 1500,        // Minimum 1.5 second delay
  maxDelayMs: 4000         // Maximum 4 second delay
});