const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const glob = require('glob');

console.log('FILES TO ZIP AND DELETE:');
console.log('='.repeat(70));

// Find all piaware log files
const files = glob.sync('piaware_aircraft_log_*.json');
let totalSize = 0;

files.forEach(f => {
  const stats = fs.statSync(f);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log('  ' + f + ' (' + sizeMB + ' MB)');
  totalSize += stats.size;
});

console.log('');
console.log('Total size: ' + (totalSize / 1024 / 1024).toFixed(2) + ' MB');
console.log('');

// Create timestamp for zip file
const now = new Date();
const timestamp = now.getFullYear() + 
  String(now.getMonth() + 1).padStart(2, '0') + 
  String(now.getDate()).padStart(2, '0') + '_' +
  String(now.getHours()).padStart(2, '0') +
  String(now.getMinutes()).padStart(2, '0') +
  String(now.getSeconds()).padStart(2, '0');

const zipFile = 'piaware_aircraft_logs_' + timestamp + '.zip';

console.log('Creating zip file: ' + zipFile);

// Use PowerShell to create zip - quote each file path
const fileList = files.map(f => {
  const fullPath = path.resolve(f);
  return fullPath;
}).join('","');

try {
  const cmd = 'powershell -Command "Compress-Archive -Path ' + files.join(',') + ' -DestinationPath ' + zipFile + ' -Force"';
  execSync(cmd, { stdio: 'inherit' });
  
  console.log('✓ Zip file created successfully');
  
  const zipStats = fs.statSync(zipFile);
  console.log('Zip file size: ' + (zipStats.size / 1024 / 1024).toFixed(2) + ' MB');
  console.log('');
  
  console.log('Deleting original files...');
  files.forEach(f => {
    fs.unlinkSync(f);
    console.log('  Deleted: ' + f);
  });
  console.log('✓ Original files deleted');
  
  console.log('');
  console.log('SUMMARY:');
  console.log('  Archived: ' + files.length + ' files');
  console.log('  Zip file: ' + zipFile);
  console.log('  Location: ' + process.cwd());
} catch (e) {
  console.error('Error:', e.message);
}
