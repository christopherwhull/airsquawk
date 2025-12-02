const axios = require('axios');

async function test() {
    try {
        console.log('Testing heatmap API with Boeing filter...\n');
        
        const response = await axios.get('http://localhost:3002/api/heatmap', {
            params: {
                manufacturer: 'Boeing',
                timeWindow: 'all'
            }
        });
        
        console.log('Response status:', response.status);
        console.log('Response data keys:', Object.keys(response.data));
        console.log('Positions count:', response.data.positions?.length);
        console.log('First 3 positions:', JSON.stringify(response.data.positions?.slice(0, 3), null, 2));
        
    } catch (error) {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

test();
