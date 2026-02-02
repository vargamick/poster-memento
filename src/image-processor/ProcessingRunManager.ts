/**
 * Processing Run Manager
 *
 * Manages processing runs to track which files have been processed without
 * renaming the original files. Each run creates a folder with metadata about
 * what was processed, results, and timing information.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export interface ProcessedFileRecord {
  /** Original file path */
  filePath: string;
  /** Original filename */
  filename: string;
  /** SHA-256 hash of the file content */
  fileHash: string;
  /** File size in bytes */
  fileSizeBytes: number;
  /** Whether processing succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Entity name if successfully created */
  entityName?: string;
  /** Timestamp when processed */
  processedAt: string;
}

export interface RunMetadata {
  /** Unique run identifier */
  runId: string;
  /** Human-readable run name */
  runName: string;
  /** When the run started */
  startedAt: string;
  /** When the run completed (if finished) */
  completedAt?: string;
  /** Run status */
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** Source directory that was processed */
  sourceDirectory: string;
  /** Vision model used */
  visionModel: string;
  /** Processing options used */
  options: Record<string, unknown>;
  /** Statistics */
  stats: {
    totalFiles: number;
    processedFiles: number;
    successfulFiles: number;
    failedFiles: number;
    skippedFiles: number;
  };
}

export interface ProcessingRun {
  metadata: RunMetadata;
  files: ProcessedFileRecord[];
}

export class ProcessingRunManager {
  private runsDirectory: string;
  private currentRun: ProcessingRun | null = null;
  private currentRunPath: string | null = null;

  constructor(runsDirectory?: string) {
    this.runsDirectory = runsDirectory || './processing-runs';
    this.ensureRunsDirectory();
  }

  private ensureRunsDirectory(): void {
    if (!fs.existsSync(this.runsDirectory)) {
      fs.mkdirSync(this.runsDirectory, { recursive: true });
    }
  }

  /**
   * Generate a unique run ID
   */
  private generateRunId(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const random = crypto.randomBytes(4).toString('hex');
    return `run-${timestamp}-${random}`;
  }

  /**
   * Start a new processing run
   */
  startRun(options: {
    sourceDirectory: string;
    visionModel: string;
    runName?: string;
    processingOptions?: Record<string, unknown>;
  }): RunMetadata {
    const runId = this.generateRunId();
    const runName = options.runName || `Processing ${path.basename(options.sourceDirectory)}`;

    const metadata: RunMetadata = {
      runId,
      runName,
      startedAt: new Date().toISOString(),
      status: 'running',
      sourceDirectory: options.sourceDirectory,
      visionModel: options.visionModel,
      options: options.processingOptions || {},
      stats: {
        totalFiles: 0,
        processedFiles: 0,
        successfulFiles: 0,
        failedFiles: 0,
        skippedFiles: 0
      }
    };

    this.currentRun = {
      metadata,
      files: []
    };

    // Create run directory
    this.currentRunPath = path.join(this.runsDirectory, runId);
    fs.mkdirSync(this.currentRunPath, { recursive: true });

    // Save initial metadata
    this.saveCurrentRun();

    console.log(`Started processing run: ${runId}`);
    console.log(`Run directory: ${this.currentRunPath}`);

    return metadata;
  }

  /**
   * Set the total number of files to be processed
   */
  setTotalFiles(count: number): void {
    if (this.currentRun) {
      this.currentRun.metadata.stats.totalFiles = count;
      this.saveCurrentRun();
    }
  }

  /**
   * Record a processed file
   */
  recordProcessedFile(record: ProcessedFileRecord): void {
    if (!this.currentRun) {
      throw new Error('No active run. Call startRun() first.');
    }

    this.currentRun.files.push(record);
    this.currentRun.metadata.stats.processedFiles++;

    if (record.success) {
      this.currentRun.metadata.stats.successfulFiles++;
    } else if (record.error?.includes('already processed') || record.error?.includes('skipped')) {
      this.currentRun.metadata.stats.skippedFiles++;
    } else {
      this.currentRun.metadata.stats.failedFiles++;
    }

    // Save periodically (every 10 files)
    if (this.currentRun.files.length % 10 === 0) {
      this.saveCurrentRun();
    }
  }

  /**
   * Complete the current run
   */
  completeRun(status: 'completed' | 'failed' | 'cancelled' = 'completed'): RunMetadata | null {
    if (!this.currentRun) {
      return null;
    }

    this.currentRun.metadata.status = status;
    this.currentRun.metadata.completedAt = new Date().toISOString();

    this.saveCurrentRun();

    const metadata = this.currentRun.metadata;
    this.currentRun = null;
    this.currentRunPath = null;

    return metadata;
  }

  /**
   * Save current run to disk
   */
  private saveCurrentRun(): void {
    if (!this.currentRun || !this.currentRunPath) {
      return;
    }

    // Save metadata
    const metadataPath = path.join(this.currentRunPath, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(this.currentRun.metadata, null, 2));

    // Save processed files list
    const filesPath = path.join(this.currentRunPath, 'processed-files.json');
    fs.writeFileSync(filesPath, JSON.stringify(this.currentRun.files, null, 2));

    // Save a summary of successful entities
    const successfulFiles = this.currentRun.files.filter(f => f.success);
    if (successfulFiles.length > 0) {
      const entitiesPath = path.join(this.currentRunPath, 'entities-summary.json');
      fs.writeFileSync(entitiesPath, JSON.stringify(
        successfulFiles.map(f => ({
          filename: f.filename,
          entityName: f.entityName,
          fileHash: f.fileHash
        })),
        null,
        2
      ));
    }
  }

  /**
   * Get file hash
   */
  getFileHash(filePath: string): string {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  /**
   * Check if a file has been processed in any previous run
   */
  isFileProcessed(filePath: string): { processed: boolean; runId?: string; record?: ProcessedFileRecord } {
    const fileHash = this.getFileHash(filePath);

    // Check current run first
    if (this.currentRun) {
      const record = this.currentRun.files.find(f => f.fileHash === fileHash);
      if (record) {
        return { processed: true, runId: this.currentRun.metadata.runId, record };
      }
    }

    // Check all previous runs
    const runs = this.listRuns();
    for (const run of runs) {
      const fullRun = this.loadRun(run.runId);
      if (fullRun) {
        const record = fullRun.files.find(f => f.fileHash === fileHash && f.success);
        if (record) {
          return { processed: true, runId: run.runId, record };
        }
      }
    }

    return { processed: false };
  }

  /**
   * List all runs
   */
  listRuns(): RunMetadata[] {
    if (!fs.existsSync(this.runsDirectory)) {
      return [];
    }

    const runs: RunMetadata[] = [];
    const entries = fs.readdirSync(this.runsDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('run-')) {
        const metadataPath = path.join(this.runsDirectory, entry.name, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as RunMetadata;
            runs.push(metadata);
          } catch {
            // Skip invalid metadata files
          }
        }
      }
    }

    // Sort by start time, newest first
    return runs.sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  /**
   * Load a specific run
   */
  loadRun(runId: string): ProcessingRun | null {
    const runPath = path.join(this.runsDirectory, runId);
    const metadataPath = path.join(runPath, 'metadata.json');
    const filesPath = path.join(runPath, 'processed-files.json');

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as RunMetadata;
      const files = fs.existsSync(filesPath)
        ? JSON.parse(fs.readFileSync(filesPath, 'utf-8')) as ProcessedFileRecord[]
        : [];

      return { metadata, files };
    } catch {
      return null;
    }
  }

  /**
   * Get the current run metadata
   */
  getCurrentRun(): RunMetadata | null {
    return this.currentRun?.metadata || null;
  }

  /**
   * Get all files processed across all runs (for deduplication)
   */
  getAllProcessedFileHashes(): Set<string> {
    const hashes = new Set<string>();

    const runs = this.listRuns();
    for (const run of runs) {
      const fullRun = this.loadRun(run.runId);
      if (fullRun) {
        for (const file of fullRun.files) {
          if (file.success) {
            hashes.add(file.fileHash);
          }
        }
      }
    }

    return hashes;
  }

  /**
   * Get run directory path
   */
  getRunsDirectory(): string {
    return this.runsDirectory;
  }

  /**
   * Get current run path
   */
  getCurrentRunPath(): string | null {
    return this.currentRunPath;
  }
}

/**
 * Create a ProcessingRunManager with default configuration
 */
export function createProcessingRunManager(runsDirectory?: string): ProcessingRunManager {
  return new ProcessingRunManager(runsDirectory);
}
