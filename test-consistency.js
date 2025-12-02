const axios = require('axios');

async function test() {
    try {
        const statsResponse = await axios.get('http://localhost:3002/api/heatmap-stats');
        console.log('Stats Response:', JSON.stringify(statsResponse.data, null, 2));
    } catch (error) {
        console.error('Error:', error.message);
    }
}

test();
