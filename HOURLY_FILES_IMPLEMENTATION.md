# Server Hourly Files Implementation TODO

## Overview
Modify the Node.js server to consume pre-built hourly files from the read bucket instead of processing minute files for aggregations and historical data.

## Current Architecture Analysis
- **Read Bucket**: `aircraft-data` (historical data)
- **Write Bucket**: `aircraft-data-new` (current data + aggregations)
- **Position Cache**: Currently loads minute files from both buckets
- **Background Jobs**: Process minute files to create hourly aggregations
- **API Routes**: Serve data from write bucket aggregations

## Implementation Plan

### Phase 1: Position Cache Updates ✅ COMPLETED
- [x] Modify `lib/position-cache.js` to load hourly files from read bucket for historical data (7+ days old)
- [x] Keep minute file loading for recent data (< 7 days) from write bucket
- [x] Update cache refresh logic to handle mixed data sources
- [x] Add hourly file parsing logic to extract position records

### Phase 2: Background Job Modifications ✅ COMPLETED
- [x] Update `buildHourlyPositionsFromS3()` to prioritize reading existing hourly files from read bucket
- [x] Modify logic to only process minute files when hourly files are missing
- [x] Update `remakeHourlyRollup()` to work with existing hourly files in read bucket
- [x] Add validation to ensure hourly files contain expected data structure

### Phase 3: Aggregator Updates ✅ COMPLETED
- [x] Modify `lib/aggregators.js` functions to use hourly files from read bucket for:
  - Airline statistics computation
  - Squawk transition analysis
  - Historical data aggregation
- [x] Update flight building logic to work with hourly position data
- [x] Ensure backward compatibility with existing minute-based processing

### Phase 4: API Route Changes ✅ COMPLETED
- [x] Update `lib/api-routes.js` to serve data from read bucket hourly files when available
- [x] Modify heatmap and position endpoints to use hourly aggregations
- [x] Update status endpoints to reflect hourly file processing
- [x] Add API endpoints to query hourly file availability and freshness

### Phase 5: Configuration Updates ✅ COMPLETED
- [x] Update `config.js` with new bucket processing options
- [x] Add configuration flags for hourly file processing mode
- [x] Update background job intervals for hourly file processing
- [x] Add validation for hourly file data structure

### Phase 6: Testing & Validation ✅ COMPLETED
- [x] Create tests for hourly file parsing and processing
- [x] Add integration tests for mixed minute/hourly data sources
- [x] Update existing tests to work with new data flow
- [x] Validate performance improvements with hourly files

### Phase 7: Aircraft Tracker Updates ✅ COMPLETED
- [x] Modify aircraft tracker to upload hourly files to read bucket
- [x] Update rollup logic to target read bucket for historical data
- [x] Ensure compatibility with existing minute file uploads
- [x] Test end-to-end data flow with new architecture

## Benefits
- Reduced processing load on server (no minute file aggregation)
- Faster API responses using pre-aggregated hourly data
- Better scalability for historical data queries
- Cleaner separation of concerns (tracker uploads, server consumes)

## Risk Mitigation
- Maintain backward compatibility with minute file processing
- Add feature flags to enable/disable hourly file processing
- Comprehensive testing before full rollout
- Gradual migration with monitoring

## Success Criteria ✅ ALL COMPLETED
- [x] Server can load position data from hourly files in read bucket
- [x] API responses remain consistent and performant
- [x] All existing tests pass with new data flow
- [x] Aircraft tracker successfully uploads to read bucket
- [x] No data loss during transition
- [x] Performance improvements validated</content>
<parameter name="filePath">c:\Users\chris\aircraft-dashboard-new\HOURLY_FILES_IMPLEMENTATION.md