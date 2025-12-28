async function doUpdateLiveMarkers(positions) {
            try {
                const now = Date.now();
                const TIMEOUT_MS = 15 * 1000; // 15 seconds

                // Mark all existing markers as not seen in this update
                for (const [hex, markerData] of liveMarkers.entries()) {
                    markerData.seenInUpdate = false;
                }

                const chunkSize = 200;
                for (let i = 0; i < positions.length; i += chunkSize) {
                    const slice = positions.slice(i, i + chunkSize);
                    for (const p of slice) {
                        try {
                            const lat = p.lat ?? p.Latitude ?? p.latitude;
                            const lon = p.lon ?? p.Longitude ?? p.longitude;
                            if (typeof lat !== 'number' || typeof lon !== 'number') continue;
                            const hex = (p.hex || '').toLowerCase();

                            // Calculate vertical rate for color coding
                            let verticalRate = 0;
                            try {
                                const alt = p.alt || p.altitude || p.Alt || p.Altitude || null;
                                if (alt !== null && typeof alt === 'number') {
                                    const prevData = verticalRateCache.get(hex);
                                    if (prevData) {
                                        const timeDiff = (now - prevData.timestamp) / 1000;
                                        if (timeDiff > 30 && timeDiff < 300) {
                                            const altDiff = alt - prevData.altitude;
                                            verticalRate = (altDiff / timeDiff) * 60;
                                        }
                                    }
                                    verticalRateCache.set(hex, { altitude: alt, timestamp: now });
                                }
                            } catch (e) {}

                            const existingMarkerData = liveMarkers.get(hex);
                            if (existingMarkerData) {
                                existingMarkerData.marker.setLatLng([lat, lon]);
                                existingMarkerData.marker._posData = p;
                                existingMarkerData.lastSeen = now;
                                existingMarkerData.seenInUpdate = true;

                                const tooltipHtml = buildHoverTooltipHTML(p);
                                try { existingMarkerData.marker.getTooltip().setContent(tooltipHtml); } catch (e) {}
                                try { existingMarkerData.marker.getPopup().setContent(tooltipHtml); } catch (e) {}

                                try {
                                    const aircraftInfo = {
                                        manufacturer: p.manufacturer || p.airline || null,
                                        typecode: p.aircraft_type || null
                                    };
                                    if (aircraftInfo.typecode) {
                                        const track = p.heading || p.track || p.course || 0;
                                        const rot = (track - 90 + 360) % 360;
                                        const newIcon = createAircraftLogoIcon(aircraftInfo, rot, 50, verticalRate);
                                        existingMarkerData.marker.setIcon(newIcon);
                                    }
                                } catch (e) {}
                            } else {
                                let icon;
                                const track = p.heading || p.track || p.course || 0;
                                const rot = (track - 90 + 360) % 360; // Aircraft icon points east by default, so subtract 90 degrees
                                
                                try {
                                    const aircraftInfo = {
                                        manufacturer: p.manufacturer || p.airline || null,
                                        typecode: p.aircraft_type || null
                                    };
                                    icon = createAircraftLogoIcon(aircraftInfo, rot, 50, verticalRate);
                                } catch (e) {
                                    let fallbackColor = '#ff3300';
                                    if (verticalRate > 500) {
                                        fallbackColor = '#00ff00';
                                    } else if (verticalRate < -300) {
                                        fallbackColor = '#ff0000';
                                    }
                                    icon = createAircraftIcon(fallbackColor, 50, rot);
                                }

                                const marker = L.marker([lat, lon], { icon, pane: 'livePane', zIndexOffset: 1000 });

                                // Tooltip and popup
                                const tooltipHtml = buildHoverTooltipHTML(p);
                                marker.bindTooltip(tooltipHtml, { direction: 'top', offset: [0, -10], sticky: true });
                                marker.bindPopup(tooltipHtml);

                                // Ensure posData includes squawk fallback
                                try {
                                    const v = p.sqk || p.squawk || p.transponder || p.transponder_code || p.squawk_code || null;
                                    if (v) { p.sqk = v; p.squawk = p.squawk || v; }
                                    else if (lastSquawk.has(hex)) { const ls = lastSquawk.get(hex); if (ls) { p.sqk = ls; p.squawk = p.squawk || ls; } }
                                } catch (e) {}
                                try { lastPositions.set(hex, [[lat, lon]]); } catch (e) {}

                                marker._posData = p;

                                liveLayer.addLayer(marker);
                                liveMarkers.set(hex, { marker, lastSeen: now, seenInUpdate: true });
                            }
                        } catch (e) {}
                    }
                    await new Promise(r => setTimeout(r, 0));
                }

                // Remove markers that weren't seen in this update and have timed out
                for (const [hex, markerData] of liveMarkers.entries()) {
                    if (!markerData.seenInUpdate && (now - markerData.lastSeen > TIMEOUT_MS)) {
                        try {
                            liveLayer.removeLayer(markerData.marker);
                            liveMarkers.delete(hex);
                            liveTrails.delete(hex);
                        } catch (e) {
                            console.warn('Failed to remove timed out marker for', hex, e);
                        }
                    }
                }

                // Ensure live layer is on the map
                if (!window.map.hasLayer(liveLayer)) liveLayer.addTo(window.map);
                
                try { updateDebugInfo(); } catch(e) {}
            } catch (e) {
                console.error('Error updating live markers (async):', e);
            }
        }