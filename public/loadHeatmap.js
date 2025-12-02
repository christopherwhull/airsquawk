async function loadHeatmap(hoursBack = null) {
    try {
        const airline = document.getElementById('heatmap-airline').value;
        const type = document.getElementById('heatmap-type').value;
        const manufacturer = document.getElementById('heatmap-manufacturer').value;
        const statusElem = document.getElementById('heatmap-total-positions');
        
        // Show loading state
        if (statusElem) {
            statusElem.textContent = 'Loading...';
            statusElem.style.color = '#ffa500'; // Orange for loading
        }
        
        let timeWindow = '7d'; // default
        
        // If hoursBack is provided, convert to window parameter
        if (hoursBack !== null) {
            if (hoursBack === 1) timeWindow = '1h';
            else if (hoursBack === 6) timeWindow = '6h';
            else if (hoursBack === 24) timeWindow = '24h';
            else if (hoursBack === 168) timeWindow = '7d';
            else if (hoursBack === 744) timeWindow = 'all';
        } else {
            // Get window from dropdown if available
            const windowSelect = document.getElementById('heatmap-window');
            if (windowSelect) {
                timeWindow = windowSelect.value || '7d';
            }
        }
        
        // Build query parameters
        const params = new URLSearchParams({ window: timeWindow });
        if (airline) params.append('airline', airline);
        if (type) params.append('type', type);
        if (manufacturer) params.append('manufacturer', manufacturer);
        
        console.log('Loading heatmap with params:', Object.fromEntries(params));
        
        // Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch(`/api/heatmap?${params.toString()}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
async function loadHeatmap(hoursBack = null) {
    try {
        const airline = document.getElementById('heatmap-airline').value;
        const type = document.getElementById('heatmap-type').value;
        const manufacturer = document.getElementById('heatmap-manufacturer').value;
        const statusElem = document.getElementById('heatmap-total-positions');

        // Show loading state
        if (statusElem) {
            statusElem.textContent = 'Loading...';
            statusElem.style.color = '#ffa500'; // Orange for loading
        }

        let timeWindow = '7d'; // default

        // If hoursBack is provided, convert to window parameter
        if (hoursBack !== null) {
            if (hoursBack === 1) timeWindow = '1h';
            else if (hoursBack === 6) timeWindow = '6h';
            else if (hoursBack === 24) timeWindow = '24h';
            else if (hoursBack === 168) timeWindow = '7d';
            else if (hoursBack === 744) timeWindow = 'all';
        } else {
            // Get window from dropdown if available
            const windowSelect = document.getElementById('heatmap-window');
            if (windowSelect) {
                timeWindow = windowSelect.value || '7d';
            }
        }

        // Build query parameters
        const params = new URLSearchParams({ window: timeWindow });
        if (airline) params.append('airline', airline);
        if (type) params.append('type', type);
        if (manufacturer) params.append('manufacturer', manufacturer);

        console.log('Loading heatmap with params:', Object.fromEntries(params));

        // Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const response = await fetch(`/api/heatmap?${params.toString()}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const gridData = await response.json();
        console.log(`Received ${gridData.length} grid cells for heatmap`);

        // Store grid data globally for scale adjustments
        window.currentHeatmapData = gridData;

        // Update the heatmap display
        updateHeatmapDisplay(gridData);
        
    } catch (error) {
        console.error('Error loading heatmap:', error);
        const statusElem = document.getElementById('heatmap-total-positions');
        
        if (error.name === 'AbortError') {
            if (statusElem) {
                statusElem.textContent = 'Request timed out';
                statusElem.style.color = '#ff9800';
            }
        } else {
            if (statusElem) {
                statusElem.textContent = `Error: ${error.message}`;
                statusElem.style.color = '#f44336';
            }
        }
    }
}

function updateHeatmapDisplay(gridData) {
    console.log(`Rendering ${gridData.length} grid cells`);

    const canvas = document.getElementById('heatmap-canvas');
    const statusElem = document.getElementById('heatmap-total-positions');

    if (!canvas) {
        console.error('Heatmap canvas not found');
        return;
    }

    // Get scale options from controls
    const scaleType = document.getElementById('heatmap-scale-type')?.value || 'log';
    const colorScheme = document.getElementById('heatmap-color-scheme')?.value || 'red';
    const minValueInput = document.getElementById('heatmap-min-value');
    const maxValueInput = document.getElementById('heatmap-max-value');
    const intensityRange = parseInt(document.getElementById('heatmap-intensity-range')?.value || '40');
    const saturation = parseInt(document.getElementById('heatmap-saturation')?.value || '100');
    const lightness = parseInt(document.getElementById('heatmap-lightness')?.value || '50');
    const opacity = parseFloat(document.getElementById('heatmap-opacity')?.value || '1.0');
    const blur = parseFloat(document.getElementById('heatmap-blur')?.value || '0');
    const gamma = parseFloat(document.getElementById('heatmap-gamma')?.value || '1.0');
    const gridSize = document.getElementById('heatmap-grid-size')?.value || 'auto';
    const interpolation = document.getElementById('heatmap-interpolation')?.value || 'none';
    const showLegend = document.getElementById('heatmap-show-legend')?.checked ?? true;

    const minValue = minValueInput && minValueInput.value ? parseFloat(minValueInput.value) : null;
    const maxValue = maxValueInput && maxValueInput.value ? parseFloat(maxValueInput.value) : null;

    const options = {
        scaleType: scaleType,
        colorScheme: colorScheme,
        minValue: minValue,
        maxValue: maxValue,
        intensityRange: intensityRange,
        saturation: saturation,
        lightness: lightness,
        opacity: opacity,
        blur: blur,
        gamma: gamma,
        gridSize: gridSize,
        interpolation: interpolation,
        showLegend: showLegend
    };

    // Call the renderHeatmap function from heatmap-grid.js
    if (typeof window.renderHeatmap === 'function') {
        console.log('Calling renderHeatmap with grid data and options:', options);
        window.renderHeatmap(gridData, canvas, options);

        // Calculate total positions
        let totalPositions = 0;
        for (const cell of gridData) {
            totalPositions += cell.count || 0;
        }

        if (statusElem) {
            statusElem.textContent = `${totalPositions.toLocaleString()} positions in ${gridData.length} grid cells`;
            statusElem.style.color = '#4caf50';
        }
    } else {
        console.error('renderHeatmap function not found');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f44336';
        ctx.font = '14px sans-serif';
        ctx.fillText('Rendering library not loaded', 10, 30);
        if (statusElem) {
            statusElem.textContent = 'Error: Rendering library not loaded';
            statusElem.style.color = '#f44336';
        }
    }
}

// Initialize heatmap filters
async function initializeHeatmapFilters() {
    try {
        // Show loading state
        const airlineSelect = document.getElementById('heatmap-airline');
        const typeSelect = document.getElementById('heatmap-type');
        const manufacturerSelect = document.getElementById('heatmap-manufacturer');
        const statusElem = document.getElementById('heatmap-total-positions');
        
        // Disable selects and show loading
        airlineSelect.disabled = true;
        typeSelect.disabled = true;
        manufacturerSelect.disabled = true;
        
        if (statusElem) {
            statusElem.textContent = 'Loading filter data...';
            statusElem.style.color = '#ffa500'; // Orange for loading
        }
        
        // Clear existing options except "All"
        airlineSelect.innerHTML = '<option value="">All Airlines</option>';
        typeSelect.innerHTML = '<option value="">All Types</option>';
        manufacturerSelect.innerHTML = '<option value="">All Manufacturers</option>';
        
        // Load airlines for filter
        const airlineResponse = await fetch('/api/airlines');
        if (!airlineResponse.ok) {
            throw new Error(`Failed to load airlines: ${airlineResponse.status}`);
        }
        const airlines = await airlineResponse.json();
        
        Object.keys(airlines).sort().forEach(code => {
            const option = document.createElement('option');
            option.value = code;
            option.textContent = `${code} - ${airlines[code].name || 'Unknown'}`;
            airlineSelect.appendChild(option);
        });
        
        // Load aircraft types for filter
        const typesResponse = await fetch('/api/aircraft-types');
        if (!typesResponse.ok) {
            throw new Error(`Failed to load aircraft types: ${typesResponse.status}`);
        }
        const typesData = await typesResponse.json();
        
        Object.keys(typesData.types || {}).sort().forEach(typeCode => {
            const typeInfo = typesData.types[typeCode];
            const option = document.createElement('option');
            option.value = typeCode;
            option.textContent = `${typeCode} - ${typeInfo.model || 'Unknown'}`;
            typeSelect.appendChild(option);
        });
        
        // Load manufacturers for filter
        const manufacturers = new Set();
        Object.values(typesData.types || {}).forEach(type => {
            if (type.manufacturer) manufacturers.add(type.manufacturer);
        });
        
        Array.from(manufacturers).sort().forEach(manufacturer => {
            const option = document.createElement('option');
            option.value = manufacturer;
            option.textContent = manufacturer;
            manufacturerSelect.appendChild(option);
        });
        
        // Enable selects and show ready state
        airlineSelect.disabled = false;
        typeSelect.disabled = false;
        manufacturerSelect.disabled = false;
        
        if (statusElem) {
            statusElem.textContent = `Filters ready - ${Object.keys(airlines).length} airlines, ${Object.keys(typesData.types || {}).length} types, ${manufacturers.size} manufacturers loaded`;
            statusElem.style.color = '#4caf50'; // Green for ready
        }
        
        console.log('Heatmap filters initialized successfully');
        
    } catch (error) {
        console.error('Error initializing heatmap filters:', error);
        
        // Re-enable selects even on error
        const airlineSelect = document.getElementById('heatmap-airline');
        const typeSelect = document.getElementById('heatmap-type');
        const manufacturerSelect = document.getElementById('heatmap-manufacturer');
        const statusElem = document.getElementById('heatmap-total-positions');
        
        airlineSelect.disabled = false;
        typeSelect.disabled = false;
        manufacturerSelect.disabled = false;
        
        if (statusElem) {
            statusElem.textContent = 'Error loading filter data - some filters may not work';
            statusElem.style.color = '#f44336'; // Red for error
        }
    }
}

// Set up event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Initialize filters when the page loads (in case heatmap tab is active by default)
    if (document.querySelector('.tab-button.active')?.textContent === 'Heatmap') {
        initializeHeatmapFilters();
        setupHeatmapEventListeners();
        // Auto-load heatmap with default 24h window
        loadHeatmap(24);
    }
});

// Tab switching function
function showTab(tabName) {
    console.log('Switching to tab:', tabName);
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => content.style.display = 'none');
    
    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));
    
    // Show the selected tab content
    const selectedTab = document.getElementById(tabName + '-tab');
    console.log('Selected tab element:', selectedTab);
    if (selectedTab) {
        selectedTab.style.display = 'block';
    }
    
    // Add active class to the clicked button
    const activeButton = Array.from(tabButtons).find(button => 
        button.textContent.toLowerCase() === tabName
    );
    if (activeButton) {
        activeButton.classList.add('active');
    }
    
    // Initialize heatmap filters when heatmap tab becomes active
    if (tabName === 'heatmap') {
        console.log('Initializing heatmap tab');
        initializeHeatmapFilters();
        setupHeatmapEventListeners();
        // Auto-load heatmap with default 24h window
        loadHeatmap(24);
    }
}

// Set up heatmap-specific event listeners
function setupHeatmapEventListeners() {
    const generateBtn = document.getElementById('generate-heatmap-btn');
    const windowSelect = document.getElementById('heatmap-window');
    
    if (generateBtn) {
        generateBtn.addEventListener('click', function() {
            const windowValue = windowSelect.value;
            let hoursBack = null;
            
            // Convert window selection to hours
            switch (windowValue) {
                case '1h': hoursBack = 1; break;
                case '4h': hoursBack = 4; break;
                case '12h': hoursBack = 12; break;
                case '24h': hoursBack = 24; break;
                case '7d': hoursBack = 168; break; // 7 * 24
                case 'all': hoursBack = null; break; // Will use default in loadHeatmap
            }
            
            loadHeatmap(hoursBack);
        });
    }
    
    // Auto-load heatmap when window selection changes
    if (windowSelect) {
        windowSelect.addEventListener('change', function() {
            // Auto-generate when window changes
            const windowValue = windowSelect.value;
            let hoursBack = null;
            
            switch (windowValue) {
                case '1h': hoursBack = 1; break;
                case '4h': hoursBack = 4; break;
                case '12h': hoursBack = 12; break;
                case '24h': hoursBack = 24; break;
                case '7d': hoursBack = 168; break;
                case 'all': hoursBack = null; break;
            }
            
            loadHeatmap(hoursBack);
        });
    }

    // Initialize scale control event listeners
    initializeScaleControls();
}

// Initialize scale control event listeners
function initializeScaleControls() {
    const scaleTypeSelect = document.getElementById('heatmap-scale-type');
    const colorSchemeSelect = document.getElementById('heatmap-color-scheme');
    const minValueInput = document.getElementById('heatmap-min-value');
    const maxValueInput = document.getElementById('heatmap-max-value');
    const intensityRangeInput = document.getElementById('heatmap-intensity-range');
    const saturationInput = document.getElementById('heatmap-saturation');
    const lightnessInput = document.getElementById('heatmap-lightness');
    const opacityInput = document.getElementById('heatmap-opacity');
    const blurInput = document.getElementById('heatmap-blur');
    const gammaInput = document.getElementById('heatmap-gamma');
    const gridSizeSelect = document.getElementById('heatmap-grid-size');
    const interpolationSelect = document.getElementById('heatmap-interpolation');
    const showLegendCheckbox = document.getElementById('heatmap-show-legend');
    const resetButton = document.getElementById('heatmap-reset-scale');
    const savePresetButton = document.getElementById('heatmap-save-preset');
    const loadPresetButton = document.getElementById('heatmap-load-preset');

    // Display value elements
    const intensityValue = document.getElementById('intensity-value');
    const saturationValue = document.getElementById('saturation-value');
    const lightnessValue = document.getElementById('lightness-value');
    const opacityValue = document.getElementById('opacity-value');
    const blurValue = document.getElementById('blur-value');
    const gammaValue = document.getElementById('gamma-value');

    // Function to re-render heatmap when scale options change
    function updateHeatmapScale() {
        if (window.currentHeatmapData) {
            updateHeatmapDisplay(window.currentHeatmapData);
        }
    }

    // Update display values for sliders
    function updateSliderDisplays() {
        if (intensityValue) intensityValue.textContent = intensityRangeInput?.value || '40';
        if (saturationValue) saturationValue.textContent = saturationInput?.value || '100';
        if (lightnessValue) lightnessValue.textContent = lightnessInput?.value || '50';
        if (opacityValue) opacityValue.textContent = opacityInput?.value || '1.0';
        if (blurValue) blurValue.textContent = blurInput?.value || '0';
        if (gammaValue) gammaValue.textContent = gammaInput?.value || '1.0';
    }

    // Add event listeners for all controls
    if (scaleTypeSelect) {
        scaleTypeSelect.addEventListener('change', updateHeatmapScale);
    }

    if (colorSchemeSelect) {
        colorSchemeSelect.addEventListener('change', updateHeatmapScale);
    }

    if (minValueInput) {
        minValueInput.addEventListener('input', updateHeatmapScale);
        minValueInput.addEventListener('change', updateHeatmapScale);
    }

    if (maxValueInput) {
        maxValueInput.addEventListener('input', updateHeatmapScale);
        maxValueInput.addEventListener('change', updateHeatmapScale);
    }

    // Slider controls with real-time updates
    [intensityRangeInput, saturationInput, lightnessInput, opacityInput, blurInput, gammaInput].forEach(input => {
        if (input) {
            input.addEventListener('input', () => {
                updateSliderDisplays();
                updateHeatmapScale();
            });
            input.addEventListener('change', () => {
                updateSliderDisplays();
                updateHeatmapScale();
            });
        }
    });

    if (gridSizeSelect) {
        gridSizeSelect.addEventListener('change', updateHeatmapScale);
    }

    if (interpolationSelect) {
        interpolationSelect.addEventListener('change', updateHeatmapScale);
    }

    if (showLegendCheckbox) {
        showLegendCheckbox.addEventListener('change', updateHeatmapScale);
    }

    if (resetButton) {
        resetButton.addEventListener('click', function() {
            // Reset all controls to defaults
            if (scaleTypeSelect) scaleTypeSelect.value = 'log';
            if (colorSchemeSelect) colorSchemeSelect.value = 'red';
            if (minValueInput) minValueInput.value = '';
            if (maxValueInput) maxValueInput.value = '';
            if (intensityRangeInput) intensityRangeInput.value = '40';
            if (saturationInput) saturationInput.value = '100';
            if (lightnessInput) lightnessInput.value = '50';
            if (opacityInput) opacityInput.value = '1.0';
            if (blurInput) blurInput.value = '0';
            if (gammaInput) gammaInput.value = '1.0';
            if (gridSizeSelect) gridSizeSelect.value = 'auto';
            if (interpolationSelect) interpolationSelect.value = 'none';
            if (showLegendCheckbox) showLegendCheckbox.checked = true;

            updateSliderDisplays();
            updateHeatmapScale();
        });
    }

    // Preset functionality
    if (savePresetButton) {
        savePresetButton.addEventListener('click', function() {
            const preset = {
                scaleType: scaleTypeSelect?.value || 'log',
                colorScheme: colorSchemeSelect?.value || 'red',
                minValue: minValueInput?.value || '',
                maxValue: maxValueInput?.value || '',
                intensityRange: intensityRangeInput?.value || '40',
                saturation: saturationInput?.value || '100',
                lightness: lightnessInput?.value || '50',
                opacity: opacityInput?.value || '1.0',
                blur: blurInput?.value || '0',
                gamma: gammaInput?.value || '1.0',
                gridSize: gridSizeSelect?.value || 'auto',
                interpolation: interpolationSelect?.value || 'none',
                showLegend: showLegendCheckbox?.checked ?? true
            };

            const presetName = prompt('Enter preset name:');
            if (presetName) {
                const presets = JSON.parse(localStorage.getItem('heatmapPresets') || '{}');
                presets[presetName] = preset;
                localStorage.setItem('heatmapPresets', JSON.stringify(presets));
                alert(`Preset "${presetName}" saved!`);
            }
        });
    }

    if (loadPresetButton) {
        loadPresetButton.addEventListener('click', function() {
            const presets = JSON.parse(localStorage.getItem('heatmapPresets') || '{}');
            const presetNames = Object.keys(presets);

            if (presetNames.length === 0) {
                alert('No presets saved yet.');
                return;
            }

            const presetName = prompt(`Available presets: ${presetNames.join(', ')}\n\nEnter preset name to load:`);
            if (presetName && presets[presetName]) {
                const preset = presets[presetName];

                // Load preset values
                if (scaleTypeSelect) scaleTypeSelect.value = preset.scaleType;
                if (colorSchemeSelect) colorSchemeSelect.value = preset.colorScheme;
                if (minValueInput) minValueInput.value = preset.minValue;
                if (maxValueInput) maxValueInput.value = preset.maxValue;
                if (intensityRangeInput) intensityRangeInput.value = preset.intensityRange;
                if (saturationInput) saturationInput.value = preset.saturation;
                if (lightnessInput) lightnessInput.value = preset.lightness;
                if (opacityInput) opacityInput.value = preset.opacity;
                if (blurInput) blurInput.value = preset.blur;
                if (gammaInput) gammaInput.value = preset.gamma;
                if (gridSizeSelect) gridSizeSelect.value = preset.gridSize;
                if (interpolationSelect) interpolationSelect.value = preset.interpolation;
                if (showLegendCheckbox) showLegendCheckbox.checked = preset.showLegend;

                updateSliderDisplays();
                updateHeatmapScale();
                alert(`Preset "${presetName}" loaded!`);
            }
        });
    }

    // Initialize display values
    updateSliderDisplays();
}