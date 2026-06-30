import { browserPool } from './browser-pool.js';

interface BatchProcessOptions {
  concurrencyLimit?: number;
  onProgress?: (completed: number, total: number, docketNum: string) => void;
  onError?: (error: Error, docketNum: string) => void;
}

interface DocketRequest {
  docketNum: string;
  apiEndpoint: string;
}

interface BatchResult<T = any> {
  docketNum: string;
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

export class BatchProcessor {
  private static instance: BatchProcessor;
  
  static getInstance(): BatchProcessor {
    if (!BatchProcessor.instance) {
      BatchProcessor.instance = new BatchProcessor();
    }
    return BatchProcessor.instance;
  }

  /**
   * Process multiple docket numbers in batches with controlled concurrency
   */
  async processDocketBatch<T = any>(
    requests: DocketRequest[],
    options: BatchProcessOptions = {}
  ): Promise<BatchResult<T>[]> {
    const {
      concurrencyLimit = 3, // Conservative default
      onProgress = () => {},
      onError = () => {}
    } = options;

    console.log(`🚀 Starting batch processing: ${requests.length} dockets with concurrency limit ${concurrencyLimit}`);
    
    const results: BatchResult<T>[] = [];
    const chunks = this.createChunks(requests, concurrencyLimit);
    let completed = 0;

    for (const chunk of chunks) {
      console.log(`📦 Processing chunk of ${chunk.length} dockets...`);
      
      const chunkPromises = chunk.map(async (request) => {
        const startTime = Date.now();
        
        try {
          const data = await this.fetchDocketData<T>(request);
          const result: BatchResult<T> = {
            docketNum: request.docketNum,
            success: true,
            data,
            duration: Date.now() - startTime
          };
          
          completed++;
          onProgress(completed, requests.length, request.docketNum);
          console.log(`✅ Completed ${request.docketNum} (${completed}/${requests.length})`);
          
          return result;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const result: BatchResult<T> = {
            docketNum: request.docketNum,
            success: false,
            error: errorMsg,
            duration: Date.now() - startTime
          };
          
          completed++;
          onError(error instanceof Error ? error : new Error(String(error)), request.docketNum);
          console.log(`❌ Failed ${request.docketNum}: ${errorMsg}`);
          
          return result;
        }
      });

      // Wait for current chunk to complete before processing next chunk
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      // Process results from Promise.allSettled
      chunkResults.forEach((promiseResult, index) => {
        if (promiseResult.status === 'fulfilled') {
          results.push(promiseResult.value);
        } else {
          // Fallback for rejected promises
          results.push({
            docketNum: chunk[index].docketNum,
            success: false,
            error: promiseResult.reason?.message || 'Unknown error',
            duration: 0
          });
        }
      });

      // Inter-chunk delay to be extra respectful
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        const interChunkDelay = 2000 + Math.random() * 3000; // 2-5 seconds
        console.log(`⏸️ Inter-chunk delay: ${Math.round(interChunkDelay)}ms`);
        await new Promise(resolve => setTimeout(resolve, interChunkDelay));
      }
    }

    this.logBatchSummary(results);
    return results;
  }

  private async fetchDocketData<T>(request: DocketRequest): Promise<T> {
    const url = `${request.apiEndpoint}?docketNum=${encodeURIComponent(request.docketNum)}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Excel-Script-Batch-Processor/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  private createChunks<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private logBatchSummary<T>(results: BatchResult<T>[]): void {
    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;
    const totalTime = results.reduce((sum, r) => sum + r.duration, 0);
    const avgTime = totalTime / results.length;

    console.log(`\n📊 Batch Processing Summary:`);
    console.log(`   Total: ${results.length} dockets`);
    console.log(`   ✅ Successful: ${successful}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   ⏱️ Average time per docket: ${Math.round(avgTime)}ms`);
    console.log(`   🕐 Total processing time: ${Math.round(totalTime / 1000)}s`);
    console.log(`   🏎️ Effective rate: ${Math.round(results.length / (totalTime / 1000))} dockets/second\n`);
  }

  /**
   * Convenience method for Excel scripts
   */
  async processMultipleDockets(
    docketNumbers: string[],
    apiSummaryUrl: string,
    apiDocketUrl?: string,
    options: BatchProcessOptions = {}
  ): Promise<{
    summaryResults: BatchResult[];
    docketResults?: BatchResult[];
  }> {
    // Prepare summary requests
    const summaryRequests: DocketRequest[] = docketNumbers.map(docketNum => ({
      docketNum,
      apiEndpoint: apiSummaryUrl
    }));

    console.log('📋 Processing summary data...');
    const summaryResults = await this.processDocketBatch(summaryRequests, {
      ...options,
      onProgress: (completed, total, docketNum) => {
        console.log(`📄 Summary progress: ${completed}/${total} (${docketNum})`);
        options.onProgress?.(completed, total, docketNum);
      }
    });

    let docketResults: BatchResult[] | undefined;

    // Process docket data if endpoint provided
    if (apiDocketUrl) {
      const docketRequests: DocketRequest[] = docketNumbers.map(docketNum => ({
        docketNum,
        apiEndpoint: apiDocketUrl
      }));

      console.log('📋 Processing docket data...');
      docketResults = await this.processDocketBatch(docketRequests, {
        ...options,
        onProgress: (completed, total, docketNum) => {
          console.log(`📊 Docket progress: ${completed}/${total} (${docketNum})`);
          options.onProgress?.(completed, total, docketNum);
        }
      });
    }

    return {
      summaryResults,
      docketResults
    };
  }

  /**
   * Cleanup browser pool when done
   */
  async cleanup(): Promise<void> {
    await browserPool.cleanup();
  }
}

// Export singleton instance
export const batchProcessor = BatchProcessor.getInstance();

// Cleanup on process termination
if (typeof process !== 'undefined') {
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down batch processor...');
    await batchProcessor.cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🛑 Terminating batch processor...');
    await batchProcessor.cleanup();
    process.exit(0);
  });
}