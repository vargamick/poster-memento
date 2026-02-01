/**
 * Scan Posters Tool Handler
 *
 * Discovers poster images in a source directory and returns
 * file information for batch processing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger.js';

export interface ScanPostersArgs {
  sourcePath?: string;
  extensions?: string[];
  recursive?: boolean;
  offset?: number;
  limit?: number;
}

export interface ScanPostersResult {
  success: boolean;
  sourcePath: string;
  totalFiles: number;
  returnedFiles: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  files: Array<{
    path: string;
    filename: string;
    sizeBytes: number;
    modifiedAt: string;
  }>;
  error?: string;
}

const DEFAULT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif'];

/**
 * Recursively find all image files in a directory
 */
function findImageFiles(
  dir: string,
  extensions: string[],
  recursive: boolean
): string[] {
  const files: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive) {
        files.push(...findImageFiles(fullPath, extensions, recursive));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (error) {
    logger.warn(`Error reading directory ${dir}:`, error);
  }

  return files;
}

/**
 * Handle the scan_posters tool request
 */
export async function handleScanPosters(args: ScanPostersArgs): Promise<ScanPostersResult> {
  // Get source path from args or environment
  const sourcePath = args.sourcePath || process.env.SOURCE_IMAGES_PATH || './SourceImages';
  const extensions = args.extensions || DEFAULT_EXTENSIONS;
  const recursive = args.recursive !== false; // Default to true
  const offset = args.offset || 0;
  const limit = args.limit || 100;

  logger.info('Scanning for poster images', { sourcePath, extensions, recursive, offset, limit });

  try {
    // Resolve to absolute path
    const absolutePath = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.resolve(process.cwd(), sourcePath);

    // Check if directory exists
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        sourcePath: absolutePath,
        totalFiles: 0,
        returnedFiles: 0,
        offset,
        limit,
        hasMore: false,
        files: [],
        error: `Source directory not found: ${absolutePath}`
      };
    }

    // Find all image files
    const allFiles = findImageFiles(absolutePath, extensions, recursive);
    allFiles.sort(); // Consistent ordering

    // Apply pagination
    const paginatedFiles = allFiles.slice(offset, offset + limit);
    const hasMore = offset + limit < allFiles.length;

    // Get file details
    const fileDetails = paginatedFiles.map(filePath => {
      const stats = fs.statSync(filePath);
      return {
        path: filePath,
        filename: path.basename(filePath),
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      };
    });

    logger.info('Scan complete', {
      totalFiles: allFiles.length,
      returnedFiles: fileDetails.length,
      hasMore
    });

    return {
      success: true,
      sourcePath: absolutePath,
      totalFiles: allFiles.length,
      returnedFiles: fileDetails.length,
      offset,
      limit,
      hasMore,
      files: fileDetails
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Error scanning for posters:', error);

    return {
      success: false,
      sourcePath,
      totalFiles: 0,
      returnedFiles: 0,
      offset,
      limit,
      hasMore: false,
      files: [],
      error: errorMessage
    };
  }
}
