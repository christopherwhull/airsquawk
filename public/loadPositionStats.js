async function loadPositionStats() {
    try {
        const [sessionRes, localRes, s3Res] = await Promise.all([
            fetch('/api/stats'),
            fetch('/api/local-stats'),
            fetch('/api/s3-stats')
        ]);
        const sessionData = await sessionRes.json();
        const localData = await localRes.json();
        const s3Data = await s3Res.json();

        const tableBody = document.getElementById('position-stats-table-body');
        tableBody.innerHTML = `
            <tr>
                <td>Last Minute</td>
                <td>${sessionData.positions.lastMinute}</td>
                <td>${localData.last1Min}</td>
                <td>${s3Data.lastMinute}</td>
            </tr>
            <tr>
                <td>Last 3 Minutes</td>
                <td>${sessionData.positions.last3Min}</td>
                <td>${localData.last3Min}</td>
                <td>${s3Data.last3Min}</td>
            </tr>
            <tr>
                <td>Last 10 Minutes</td>
                <td>${sessionData.positions.last10Min}</td>
                <td>${localData.last10Min}</td>
                <td>${s3Data.last10Min}</td>
            </tr>
            <tr>
                <td>Last Hour</td>
                <td>${sessionData.positions.lastHour}</td>
                <td>${localData.lastHour}</td>
                <td>${s3Data.lastHour}</td>
            </tr>
        `;
    } catch (error) {
        console.error('Error loading position stats:', error);
    }
}