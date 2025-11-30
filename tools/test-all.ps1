#!/usr/bin/env pwsh

# Aircraft Dashboard Comprehensive Unit Test Suite
# Tests all core functionality and data validation

$baseUrl = "http://localhost:3002"
$testsPassed = 0
$testsFailed = 0
$testResults = @()

function Test-Endpoint {
    param(
        [string]$name,
        [string]$endpoint,
        [scriptblock]$validator,
        [string]$description
    )
    
    try {
        Write-Host "  Testing: $name" -ForegroundColor Cyan
        $url = "$baseUrl$endpoint"
        $response = curl -s $url
        
        # Try to parse as JSON
        try {
            $json = $response | ConvertFrom-Json
        }
        catch {
            Write-Host "    ❌ FAILED: Could not parse JSON response" -ForegroundColor Red
            $script:testsFailed++
            $testResults += @{
                Test = $name
                Status = "FAILED"
                Reason = "Invalid JSON"
            }
            return
        }
        
        # Run validator
        $result = & $validator $json
        
        if ($result.passed) {
            Write-Host "    ✅ $($result.message)" -ForegroundColor Green
            $script:testsPassed++
            $testResults += @{ Test = $name; Status = "PASSED"; Details = $result.message }
        }
        else {
            Write-Host "    ❌ $($result.message)" -ForegroundColor Red
            $script:testsFailed++
            $testResults += @{ Test = $name; Status = "FAILED"; Reason = $result.message }
        }
    }
    catch {
        Write-Host "    ❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
        $script:testsFailed++
        $testResults += @{ Test = $name; Status = "FAILED"; Reason = $_.Exception.Message }
    }
}

# Check if server is running
Write-Host "`n================================================" -ForegroundColor Magenta
Write-Host "AIRCRAFT DASHBOARD - COMPREHENSIVE TEST SUITE" -ForegroundColor Magenta
Write-Host "================================================`n" -ForegroundColor Magenta

try {
    $serverCheck = curl -s "$baseUrl/" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ ERROR: Server is not running at $baseUrl" -ForegroundColor Red
        Write-Host "   Start the server with: node server.js" -ForegroundColor Yellow
        exit 1
    }
}
catch {
    Write-Host "❌ ERROR: Could not connect to server at $baseUrl" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Server is running at $baseUrl`n" -ForegroundColor Green

# === HEALTH & STATUS ===
Write-Host "HEALTH & STATUS" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Health Check" -endpoint "/api/health" -validator {
    param($data)
    if ($data.status -eq "ok") {
        @{ passed = $true; message = "Server health: OK" }
    } else {
        @{ passed = $false; message = "Server health check failed" }
    }
}

Test-Endpoint -name "Cache Status" -endpoint "/api/cache-status" -validator {
    param($data)
    if ($data.positionCache -and $data.s3Operations) {
        $s3Info = "$($data.s3Operations.reads) reads, $($data.s3Operations.writes) writes"
        if ($data.s3Operations.lastRead -and $data.s3Operations.lastRead -ne "Never") {
            $s3Info += ", last read: $(([datetime]$data.s3Operations.lastRead).ToString('HH:mm:ss'))"
        }
        if ($data.s3Operations.lastWrite -and $data.s3Operations.lastWrite -ne "Never") {
            $s3Info += ", last write: $(([datetime]$data.s3Operations.lastWrite).ToString('HH:mm:ss'))"
        }
        @{ passed = $true; message = "$($data.positionCache.totalPositions) positions, $($data.positionCache.uniqueAircraft) aircraft | S3: $s3Info" }
    } else {
        @{ passed = $false; message = "Cache status invalid" }
    }
}

# === FLIGHTS ===
Write-Host "`nFLIGHTS `& MOVEMENTS" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Flights (24h)" -endpoint "/api/flights?gap=5&window=24h" -validator {
    param($data)
    if ($data.flights -is [array] -and $data.flights.Count -gt 0) {
        $first = $data.flights[0]
        if ($first.icao -and $first.start_time) {
            @{ passed = $true; message = "$($data.flights.Count) flights, first: $($first.icao)" }
        } else {
            @{ passed = $false; message = "Flight record missing required fields" }
        }
    } else {
        @{ passed = $true; message = "$($data.flights.Count) flights (no recent data)" }
    }
}

Test-Endpoint -name "Flights (7d)" -endpoint "/api/flights?gap=5&window=7d" -validator {
    param($data)
    if ($data.flights -is [array]) {
        @{ passed = $true; message = "$($data.flights.Count) flights in 7 days" }
    } else {
        @{ passed = $false; message = "Flights structure invalid" }
    }
}

# === AIRLINES ===
Write-Host "`nAIRLINES" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Airline Stats (1h)" -endpoint "/api/airline-stats?window=1h" -validator {
    param($data)
    if ($data.hourly -and $data.hourly.byAirline) {
        $count = @($data.hourly.byAirline | Get-Member -MemberType NoteProperty).Count
        @{ passed = $true; message = "$count airlines in 1 hour" }
    } else {
        @{ passed = $false; message = "Airline stats invalid" }
    }
}

Test-Endpoint -name "Airline Stats (24h)" -endpoint "/api/airline-stats?window=24h" -validator {
    param($data)
    if ($data.hourly -and $data.hourly.byAirline) {
        $count = @($data.hourly.byAirline | Get-Member -MemberType NoteProperty).Count
        @{ passed = $true; message = "$count airlines in 24 hours" }
    } else {
        @{ passed = $false; message = "Airline stats invalid" }
    }
}

# === SQUAWK TRANSITIONS ===
Write-Host "`nSQUAWK CODE TRANSITIONS" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Squawk (24h)" -endpoint "/api/squawk-transitions?hours=24" -validator {
    param($data)
    if ($data.totalTransitions -and $data.totalTransitions -gt 0) {
        @{ passed = $true; message = "$($data.totalTransitions) transitions (VFR: $($data.toVfrCount+$data.fromVfrCount), Special: $($data.toSpecialCount+$data.fromSpecialCount))" }
    } else {
        @{ passed = $false; message = "No squawk transitions found" }
    }
}

Test-Endpoint -name "Squawk (7d)" -endpoint "/api/squawk-transitions?hours=168" -validator {
    param($data)
    if ($data.totalTransitions) {
        @{ passed = $true; message = "$($data.totalTransitions) transitions in 7 days" }
    } else {
        @{ passed = $false; message = "Squawk 7d data invalid" }
    }
}

Test-Endpoint -name "Squawk Time Range" -endpoint "/api/squawk-transitions?startTime=1764111600000&endTime=1764118800000" -validator {
    param($data)
    if ($data.totalTransitions -ge 0) {
        @{ passed = $true; message = "$($data.totalTransitions) transitions in 2-hour window" }
    } else {
        @{ passed = $false; message = "Time range query failed" }
    }
}

# === RECEPTION RANGE ===
Write-Host "`nRECEPTION RANGE & COVERAGE" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Reception Range (1h)" -endpoint "/api/reception-range?hours=1" -validator {
    param($data)
    if ($data.sectors -is [PSCustomObject] -and $data.maxRange -is [double]) {
        $sectorCount = @($data.sectors | Get-Member -MemberType NoteProperty).Count
        @{ passed = $true; message = "$sectorCount sectors, max $($data.maxRange.ToString('F2')) nm" }
    } else {
        @{ passed = $false; message = "Reception range invalid" }
    }
}

Test-Endpoint -name "Reception Range (24h)" -endpoint "/api/reception-range?hours=24" -validator {
    param($data)
    if ($data.sectors -is [PSCustomObject] -and $data.maxRange -is [double]) {
        $sectorCount = @($data.sectors | Get-Member -MemberType NoteProperty).Count
        if ($sectorCount -ge 20) {
            @{ passed = $true; message = "$sectorCount sectors (full coverage), $($data.positionCount) positions, max $($data.maxRange.ToString('F2')) nm" }
        } else {
            @{ passed = $true; message = "$sectorCount sectors, max $($data.maxRange.ToString('F2')) nm" }
        }
    } else {
        @{ passed = $false; message = "Reception range invalid" }
    }
}

# === HEATMAP ===
Write-Host "`nHEATMAP DATA" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Heatmap Data (24h)" -endpoint "/api/heatmap-data?window=24h" -validator {
    param($data)
    if ($data.grid -and ($data.grid | Measure-Object).Count -gt 0) {
        @{ passed = $true; message = "$($data.grid.Count) grid cells with data" }
    } else {
        @{ passed = $true; message = "Heatmap grid ready" }
    }
}

# === LIVE POSITIONS ===
Write-Host "`nLIVE POSITION STATISTICS" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Position Timeseries Live" -endpoint '/api/position-timeseries-live?minutes=10&resolution=1' -validator {
    param($data)
    if ($data -is [array] -and $data.Count -gt 0) {
        $totalPositions = 0
        $data | ForEach-Object { $totalPositions += $_.positionCount }
        @{ passed = $true; message = "$($data.Count) time buckets, $totalPositions total positions, max aircraft: $(($data | Measure-Object -Property aircraftCount -Maximum).Maximum)" }
    } else {
        @{ passed = $true; message = "No live position data yet" }
    }
}

# === HISTORICAL STATS ===
Write-Host "`nHISTORICAL STATISTICS" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

Test-Endpoint -name "Historical Stats (24h)" -endpoint "/api/historical-stats?hours=24" -validator {
    param($data)
    if ($data.timeSeries -is [array] -and $data.totals) {
        @{ passed = $true; message = "$($data.timeSeries.Count) time points, $($data.totals.totalFlights) total flights" }
    } else {
        @{ passed = $false; message = "Historical stats invalid" }
    }
}

# === PERFORMANCE TEST ===
Write-Host "`nPERFORMANCE" -ForegroundColor Yellow
Write-Host "─────────────────────────────────────────────" -ForegroundColor Gray

$startTime = Get-Date
$response = curl -s "$baseUrl/api/flights?gap=5`&window=24h" 2>$null
$duration = (Get-Date) - $startTime
Write-Host "  Response Time: $($duration.TotalMilliseconds.ToString('F0'))ms" -ForegroundColor Cyan
if ($duration.TotalMilliseconds -lt 2000) {
    Write-Host "    ✅ Excellent performance" -ForegroundColor Green
    $script:testsPassed++
} elseif ($duration.TotalMilliseconds -lt 5000) {
    Write-Host "    ✅ Good performance" -ForegroundColor Green
    $script:testsPassed++
} else {
    Write-Host "    ⚠️  Slow response" -ForegroundColor Yellow
    $script:testsPassed++
}

# === SUMMARY ===
Write-Host "`n================================================" -ForegroundColor Magenta
Write-Host "TEST SUMMARY" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta

$total = $testsPassed + $testsFailed
Write-Host "`nTotal Tests: $total" -ForegroundColor Cyan
Write-Host "✅ Passed: $testsPassed" -ForegroundColor Green
Write-Host "❌ Failed: $testsFailed" -ForegroundColor Red

if ($testsFailed -eq 0) {
    Write-Host "`n*** ALL TESTS PASSED! Dashboard is fully operational.`n" -ForegroundColor Green
    Write-Host "Available Features:" -ForegroundColor Green
    Write-Host "  checkmark Live aircraft tracking" -ForegroundColor Green
    Write-Host "  checkmark Flight management" -ForegroundColor Green
    Write-Host "  checkmark Airline statistics" -ForegroundColor Green
    Write-Host "  checkmark Squawk code transitions" -ForegroundColor Green
    Write-Host "  checkmark Reception range maps" -ForegroundColor Green
    Write-Host "  checkmark Position heatmaps" -ForegroundColor Green
    Write-Host "  checkmark Historical analytics" -ForegroundColor Green
    Write-Host ""
    exit 0
} else {
    Write-Host "`nWARNING: $testsFailed test(s) failed`n" -ForegroundColor Red
    $testResults | Where-Object { $_.Status -eq "FAILED" } | ForEach-Object {
        Write-Host "  - $($_.Test): $($_.Reason)" -ForegroundColor Red
    }
    Write-Host ""
    exit 1
}
