#!/usr/bin/env tsx
/**
 * File Discovery Script - Discover poster files for processing
 */

import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config';

const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.tiff', '.tif', '.bmp'];

interface DiscoveredFile {
  path: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: Date;
}

/**
 * Recursively discover files in a directory
 */
function discoverFiles(dir: string, extensions: string[] = SUPPORTED_EXTENSIONS): DiscoveredFile[] {
  const files: DiscoveredFile[] = [];

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Recursively search subdirectories
      files.push(...discoverFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        const stats = fs.statSync(fullPath);
        files.push({
          path: fullPath,
          filename: entry.name,
          extension: ext,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime
        });
      }
    }
  }

  return files;
}

/**
 * Format file size for display
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Main function
 */
async function main() {
  const sourceDir = process.env.SOURCE_IMAGES_PATH || './source-images';

  console.log('='.repeat(60));
  console.log('Poster File Discovery');
  console.log('='.repeat(60));
  console.log(`Source Directory: ${sourceDir}`);
  console.log(`Supported Extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`);
  console.log('');

  const startTime = Date.now();
  const files = discoverFiles(sourceDir);
  const elapsed = Date.now() - startTime;

  // Group by extension
  const byExtension: Record<string, DiscoveredFile[]> = {};
  for (const file of files) {
    if (!byExtension[file.extension]) {
      byExtension[file.extension] = [];
    }
    byExtension[file.extension].push(file);
  }

  // Summary statistics
  const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);

  console.log('Summary:');
  console.log('-'.repeat(40));
  console.log(`Total Files: ${files.length}`);
  console.log(`Total Size: ${formatSize(totalSize)}`);
  console.log(`Discovery Time: ${elapsed}ms`);
  console.log('');

  console.log('By Extension:');
  console.log('-'.repeat(40));
  for (const [ext, extFiles] of Object.entries(byExtension).sort()) {
    const extSize = extFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
    console.log(`  ${ext.padEnd(8)} ${String(extFiles.length).padStart(5)} files  ${formatSize(extSize).padStart(10)}`);
  }
  console.log('');

  // List files if requested
  if (process.argv.includes('--list') || process.argv.includes('-l')) {
    console.log('Files:');
    console.log('-'.repeat(60));
    for (const file of files.slice(0, 50)) {
      console.log(`  ${file.filename.padEnd(40)} ${formatSize(file.sizeBytes).padStart(10)}`);
    }
    if (files.length > 50) {
      console.log(`  ... and ${files.length - 50} more files`);
    }
  }

  // Output as JSON if requested
  if (process.argv.includes('--json') || process.argv.includes('-j')) {
    const outputPath = process.argv[process.argv.indexOf('--json') + 1] ||
                       process.argv[process.argv.indexOf('-j') + 1] ||
                       './discovered-files.json';
    fs.writeFileSync(outputPath, JSON.stringify(files, null, 2));
    console.log(`File list written to: ${outputPath}`);
  }
}

main().catch(console.error);
