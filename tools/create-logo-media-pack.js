#!/usr/bin/env node

/**
 * Logo Media Pack Generator
 *
 * Downloads all airline and manufacturer logos from S3 and creates a ZIP archive
 * for distribution or backup purposes.
 *
 * Usage: node tools/create-logo-media-pack.js
 */

const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const config = require('../config');

const s3 = new S3Client({
    endpoint: config.s3.endpoint,
    region: config.s3.region,
    credentials: config.s3.credentials,
    forcePathStyle: config.s3.forcePathStyle,
});

const readBucket = config.buckets.readBucket;

/**
 * List all logo files in the S3 bucket
 */
async function listLogoFiles() {
    console.log('📋 Listing logo files from S3...');

    const allFiles = [];
    let continuationToken = undefined;

    do {
        const params = {
            Bucket: readBucket,
            Prefix: 'logos/',
            ContinuationToken: continuationToken,
            MaxKeys: 1000 // AWS maximum per request
        };

        const command = new ListObjectsV2Command(params);
        const response = await s3.send(command);

        if (response.Contents) {
            const logoFiles = response.Contents
                .filter(obj => obj.Key && (obj.Key.endsWith('.png') || obj.Key.endsWith('.svg')))
                .map(obj => ({
                    key: obj.Key,
                    size: obj.Size,
                    lastModified: obj.LastModified
                }));

            allFiles.push(...logoFiles);
        }

        continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    console.log(`✅ Found ${allFiles.length} logo files`);
    return allFiles;
}

/**
 * Download a logo file from S3
 */
async function downloadLogo(key, outputPath) {
    const params = {
        Bucket: readBucket,
        Key: key
    };

    const command = new GetObjectCommand(params);
    const response = await s3.send(command);

    // Read the entire file into memory
    const chunks = [];
    for await (const chunk of response.Body) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Ensure output directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(outputPath, buffer);
    return buffer.length;
}

/**
 * Create ZIP archive containing all logos
 */
async function createZipArchive(logoFiles, tempDir, outputPath) {
    return new Promise((resolve, reject) => {
        console.log('📦 Creating ZIP archive...');

        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Maximum compression
        });

        output.on('close', () => {
            console.log(`✅ ZIP archive created: ${archive.pointer()} bytes`);
            resolve();
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.on('progress', (progress) => {
            if (progress.entries.processed % 50 === 0) {
                console.log(`   Processed ${progress.entries.processed}/${progress.entries.total} files`);
            }
        });

        archive.pipe(output);

        // Add all logo files to the archive
        logoFiles.forEach(file => {
            const localPath = path.join(tempDir, path.basename(file.key));
            const archivePath = file.key; // Keep the logos/ prefix in the archive
            archive.file(localPath, { name: archivePath });
        });

        archive.finalize();
    });
}

/**
 * Generate metadata file for the media pack
 */
function generateMetadata(logoFiles, outputPath) {
    const metadata = {
        generated: new Date().toISOString(),
        totalFiles: logoFiles.length,
        totalSize: logoFiles.reduce((sum, file) => sum + file.size, 0),
        files: logoFiles.map(file => ({
            filename: file.key,
            size: file.size,
            lastModified: file.lastModified
        }))
    };

    fs.writeFileSync(outputPath, JSON.stringify(metadata, null, 2));
    console.log('📄 Metadata file generated');
}

/**
 * Main function
 */
async function main() {
    try {
        console.log('🎨 Aircraft Dashboard Logo Media Pack Generator');
        console.log('===============================================\n');

        // Create temporary directory for downloads
        const tempDir = path.join(__dirname, '..', 'temp-logos');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // List all logo files
        const logoFiles = await listLogoFiles();
        if (logoFiles.length === 0) {
            console.log('❌ No logo files to process');
            return;
        }

        // Download all logos
        console.log('⬇️  Downloading logos...');
        let downloadedCount = 0;
        let totalBytes = 0;

        for (const file of logoFiles) {
            try {
                const outputPath = path.join(tempDir, path.basename(file.key));
                const bytes = await downloadLogo(file.key, outputPath);
                totalBytes += bytes;
                downloadedCount++;

                if (downloadedCount % 50 === 0) {
                    console.log(`   Downloaded ${downloadedCount}/${logoFiles.length} files`);
                }
            } catch (error) {
                console.error(`❌ Failed to download ${file.key}:`, error.message);
            }
        }

        console.log(`✅ Downloaded ${downloadedCount} logo files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);

        // Create output directory
        const outputDir = path.join(__dirname, '..', 'media-packs');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate timestamp for filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const zipFilename = `aircraft-dashboard-logos-${timestamp}.zip`;
        const zipPath = path.join(outputDir, zipFilename);

        // Create ZIP archive
        await createZipArchive(logoFiles, tempDir, zipPath);

        // Generate metadata
        const metadataPath = path.join(outputDir, `logos-metadata-${timestamp}.json`);
        generateMetadata(logoFiles, metadataPath);

        // Clean up temporary files
        console.log('🧹 Cleaning up temporary files...');
        fs.rmSync(tempDir, { recursive: true, force: true });

        console.log('\n🎉 Media pack generation complete!');
        console.log(`   📁 ZIP Archive: ${zipPath}`);
        console.log(`   📄 Metadata: ${metadataPath}`);
        console.log(`   📊 Total logos: ${logoFiles.length}`);
        console.log(`   💾 Total size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

    } catch (error) {
        console.error('❌ Error generating media pack:', error);
        process.exit(1);
    }
}

// Run the script
if (require.main === module) {
    main();
}

module.exports = { main, listLogoFiles, downloadLogo, createZipArchive, generateMetadata };