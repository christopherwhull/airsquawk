const { downloadAndParseS3File, uploadJsonToS3 } = require('./s3-helpers');
const logger = require('./logger');

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const cache = new Map();

async function getCachedOrCompute(s3, readBucket, writeBucket, cacheKey, computeFunction) {
    const now = Date.now();
    
    // 1. Check in-memory cache
    if (cache.has(cacheKey)) {
        const { timestamp, data } = cache.get(cacheKey);
        if (now - timestamp < CACHE_DURATION) {
            logger.debug(`Serving '${cacheKey}' from in-memory cache.`);
            return data;
        }
    }

    // 2. Check S3 cache
    try {
        const s3CacheData = await downloadAndParseS3File(s3, writeBucket, `${cacheKey}.json`);
        if (s3CacheData && (now - s3CacheData.timestamp < CACHE_DURATION)) {
            logger.debug(`Serving '${cacheKey}' from S3 cache.`);
            cache.set(cacheKey, { timestamp: s3CacheData.timestamp, data: s3CacheData.data });
            return s3CacheData.data;
        }
    } catch (error) {
        if (error.Code !== 'NoSuchKey') {
            logger.error(`Error reading cache from S3 for '${cacheKey}':`, error);
        }
    }

    // 3. Compute new data, then cache it
    logger.info(`No valid cache found for '${cacheKey}'. Recomputing...`);
    const newData = await computeFunction();
    const cacheEntry = {
        timestamp: now,
        data: newData
    };

    cache.set(cacheKey, cacheEntry);
    try {
        await uploadJsonToS3(s3, writeBucket, `${cacheKey}.json`, cacheEntry);
        logger.debug(`Successfully saved '${cacheKey}' to S3 cache.`);
    } catch (error) {
        logger.error(`Failed to save cache to S3 for '${cacheKey}':`, error);
    }
    
    return newData;
}

module.exports = { getCachedOrCompute };
