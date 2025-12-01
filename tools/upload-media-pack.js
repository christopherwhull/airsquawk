const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

// Accept overrides via env vars
const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const S3_REGION = process.env.AWS_REGION || process.env.S3_REGION || 'us-east-1';
const S3_ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY || 'minioadmin';
const S3_SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY || 'minioadmin123';
const S3_FORCE_PATH_STYLE = (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true';

const BUCKET_NAME = process.env.MEDIA_PACK_BUCKET || 'media-pack-test';
const MEDIA_PACK_DIR = process.env.MEDIA_PACK_DIR || path.join(__dirname, '..', 'media-packs');
const DRY_RUN = !!process.env.DRY_RUN || process.argv.includes('--dry-run');

const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
    },
    forcePathStyle: S3_FORCE_PATH_STYLE,
});

function findLatestMediaPack() {
    try {
        const files = fs.readdirSync(MEDIA_PACK_DIR);
        const zipFiles = files.filter(file => file.startsWith('aircraft-dashboard-logos-') && file.endsWith('.zip'));

        if (zipFiles.length === 0) {
            console.error('No media pack ZIP files found in', MEDIA_PACK_DIR);
            return null;
        }

        // Sort by timestamp (newest first) - filename format: aircraft-dashboard-logos-YYYY-MM-DDTHH-MM-SS.zip
        zipFiles.sort((a, b) => b.localeCompare(a));
        const latestFile = zipFiles[0];

        return {
            filename: latestFile,
            filepath: path.join(MEDIA_PACK_DIR, latestFile),
            timestamp: latestFile.match(/aircraft-dashboard-logos-(.+)\.zip/)?.[1] || 'unknown'
        };
    } catch (err) {
        console.error('Error reading media pack directory:', err.message);
        return null;
    }
}

function getFileStats(filePath) {
    try {
        const stats = fs.statSync(filePath);
        return {
            size: stats.size,
            sizeMB: (stats.size / (1024 * 1024)).toFixed(2)
        };
    } catch (err) {
        console.error('Error getting file stats:', err.message);
        return null;
    }
}

async function extractAndUploadLogos(zipFilePath, timestamp) {
    return new Promise((resolve, reject) => {
        const uploadedFiles = [];
        const failedFiles = [];
        let totalFiles = 0;
        let processedFiles = 0;

        yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
            if (err) {
                reject(err);
                return;
            }

            zipfile.readEntry();
            zipfile.on('entry', async (entry) => {
                // Skip directories
                if (/\/$/.test(entry.fileName)) {
                    zipfile.readEntry();
                    return;
                }

                totalFiles++;
                const filename = path.basename(entry.fileName);

                // Only process files in logos/ directory OR aircraft_types.json
                if (!entry.fileName.startsWith('logos/') && entry.fileName !== 'aircraft_types.json') {
                    zipfile.readEntry();
                    return;
                }

                try {
                    // Extract file content
                    const content = await extractFileContent(zipfile, entry);

                    // Upload to S3
                    const objectKey = entry.fileName; // Keep the logos/ prefix
                    const contentType = getContentType(filename);

                    if (!DRY_RUN) {
                        const command = new PutObjectCommand({
                            Bucket: BUCKET_NAME,
                            Key: objectKey,
                            Body: content,
                            ContentType: contentType,
                            Metadata: {
                                'source': 'media-pack',
                                'generated-timestamp': timestamp,
                                'upload-date': new Date().toISOString()
                            }
                        });

                        await s3.send(command);
                    }

                    uploadedFiles.push(objectKey);
                    processedFiles++;

                    // Show progress
                    if (processedFiles % 100 === 0 || processedFiles === totalFiles) {
                        console.log(`Uploaded ${processedFiles}/${totalFiles} files...`);
                    }

                } catch (error) {
                    console.error(`Failed to upload ${entry.fileName}:`, error.message);
                    failedFiles.push(entry.fileName);
                    processedFiles++;
                }

                zipfile.readEntry();
            });

            zipfile.on('end', () => {
                console.log(`\nExtraction complete:`);
                console.log(`✓ Uploaded: ${uploadedFiles.length} files`);
                if (failedFiles.length > 0) {
                    console.log(`✗ Failed: ${failedFiles.length} files`);
                    failedFiles.slice(0, 5).forEach(file => console.log(`  - ${file}`));
                    if (failedFiles.length > 5) {
                        console.log(`  ... and ${failedFiles.length - 5} more`);
                    }
                }
                resolve({ uploaded: uploadedFiles.length, failed: failedFiles.length });
            });

            zipfile.on('error', reject);
        });
    });
}

function extractFileContent(zipfile, entry) {
    return new Promise((resolve, reject) => {
        const chunks = [];

        zipfile.openReadStream(entry, (err, readStream) => {
            if (err) {
                reject(err);
                return;
            }

            readStream.on('data', (chunk) => {
                chunks.push(chunk);
            });

            readStream.on('end', () => {
                resolve(Buffer.concat(chunks));
            });

            readStream.on('error', reject);
        });
    });
}

function getContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.png': return 'image/png';
        case '.svg': return 'image/svg+xml';
        case '.jpg':
        case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        default: return 'application/octet-stream';
    }
}

async function uploadMediaPack(fileInfo) {
    const fileStats = getFileStats(fileInfo.filepath);
    if (!fileStats) {
        console.error('Cannot get file statistics');
        return false;
    }

    console.log(`Found media pack: ${fileInfo.filename} (${fileStats.sizeMB} MB)`);
    console.log(`Generated: ${fileInfo.timestamp}`);
    console.log(`Target bucket: s3://${BUCKET_NAME}/logos/ and s3://${BUCKET_NAME}/aircraft_types.json`);
    console.log('');

    if (DRY_RUN) {
        console.log('DRY_RUN enabled: The files will not be uploaded.');
        return true;
    }

    try {
        console.log('Extracting and uploading logo files and aircraft types...');
        const result = await extractAndUploadLogos(fileInfo.filepath, fileInfo.timestamp);

        if (result.failed === 0) {
            console.log('\n✓ All logo files and aircraft types uploaded successfully!');
        } else {
            console.log(`\n⚠ Upload completed with ${result.failed} failures.`);
        }

        return result.failed === 0;
    } catch (error) {
        console.error('✗ Error during extraction/upload:', error.message);
        return false;
    }
}

async function main() {
    console.log('Aircraft Dashboard Media Pack S3 Uploader');
    console.log('==========================================');
    console.log(`Target bucket: ${BUCKET_NAME}`);
    console.log('Handles: logos/ directory and aircraft_types.json');
    console.log('');

    const fileInfo = findLatestMediaPack();
    if (!fileInfo) {
        process.exit(1);
    }

    const success = await uploadMediaPack(fileInfo);
    if (!success) {
        process.exit(1);
    }

    console.log('\nUpload complete!');
}

if (require.main === module) {
    main().catch(err => {
        console.error('Unexpected error:', err);
        process.exit(1);
    });
}

module.exports = { findLatestMediaPack, uploadMediaPack };