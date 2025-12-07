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

### Phase 1: Position Cache Updates
- [ ] Modify `lib/position-cache.js` to load hourly files from read bucket for historical data (7+ days old)
- [ ] Keep minute file loading for recent data (< 7 days) from write bucket
- [ ] Update cache refresh logic to handle mixed data sources
- [ ] Add hourly file parsing logic to extract position records

### Phase 2: Background Job Modifications
- [ ] Update `buildHourlyPositionsFromS3()` to prioritize reading existing hourly files from read bucket
- [ ] Modify logic to only process minute files when hourly files are missing
- [ ] Update `remakeHourlyRollup()` to work with existing hourly files in read bucket
- [ ] Add validation to ensure hourly files contain expected data structure

### Phase 3: Aggregator Updates
- [ ] Modify `lib/aggregators.js` functions to use hourly files from read bucket for:
  - Airline statistics computation
  - Squawk transition analysis
  - Historical data aggregation
- [ ] Update flight building logic to work with hourly position data
- [ ] Ensure backward compatibility with existing minute-based processing

### Phase 4: API Route Changes
- [ ] Update `lib/api-routes.js` to serve data from read bucket hourly files when available
- [ ] Modify heatmap and position endpoints to use hourly aggregations
- [ ] Update status endpoints to reflect hourly file processing
- [ ] Add API endpoints to query hourly file availability and freshness

### Phase 5: Configuration Updates
- [ ] Update `config.js` with new bucket processing options
- [ ] Add configuration flags for hourly file processing mode
- [ ] Update background job intervals for hourly file processing
- [ ] Add validation for hourly file data structure

### Phase 6: Testing & Validation
- [ ] Create tests for hourly file parsing and processing
- [ ] Add integration tests for mixed minute/hourly data sources
- [ ] Update existing tests to work with new data flow
- [ ] Validate performance improvements with hourly files

### Phase 7: Aircraft Tracker Updates
- [ ] Modify aircraft tracker to upload hourly files to read bucket
- [ ] Update rollup logic to target read bucket for historical data
- [ ] Ensure compatibility with existing minute file uploads
- [ ] Test end-to-end data flow with new architecture

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

## Success Criteria
- [ ] Server can load position data from hourly files in read bucket
- [ ] API responses remain consistent and performant
- [ ] All existing tests pass with new data flow
- [ ] Aircraft tracker successfully uploads to read bucket
- [ ] No data loss during transition
- [ ] Performance improvements validated</content>
<parameter name="filePath">c:\Users\chris\aircraft-dashboard-new\HOURLY_FILES_IMPLEMENTATION.md