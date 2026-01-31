/**
 * Processing Service
 *
 * Orchestrates the refresh workflow with job tracking.
 * Manages long-running operations with progress reporting.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { AdminService, createAdminServiceFromEnv } from './AdminService.js';
import { S3Service, createS3ServiceFromEnv, ScrapeRunInfo } from './S3Service.js';

const execAsync = promisify(exec);

export type JobPhase =
  | 'pending'
  | 'downloading'
  | 'backing_up'
  | 'resetting'
  | 'processing_metadata'
  | 'extracting_pdf_metadata'
  | 'generating_embeddings'
  | 'cleaning_up'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobStatus {
  jobId: string;
  phase: JobPhase;
  progress: number; // 0-100
  message: string;
  scrapeRunId?: string;
  backupTimestamp?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  stats?: {
    entitiesCreated?: number;
    relationshipsCreated?: number;
    embeddingsGenerated?: number;
  };
}

export interface RefreshOptions {
  scrapeRunPath?: string; // If not provided, uses most recent FULL run
  skipBackup?: boolean; // Default false (always backup per plan)
  skipCleanup?: boolean; // Keep downloaded files after processing
}

// In-memory job storage (per plan decision)
const jobs: Map<string, JobStatus> = new Map();
let currentJob: string | null = null;

export class ProcessingService {
  private adminService: AdminService;
  private s3Service: S3Service;
  private scriptsDir: string;

  constructor(adminService: AdminService, s3Service: S3Service) {
    this.adminService = adminService;
    this.s3Service = s3Service;

    // Determine scripts directory based on environment
    const isDocker = process.env.NODE_ENV === 'production' && process.cwd().startsWith('/app');
    this.scriptsDir = isDocker
      ? '/app/instance/scripts'
      : path.resolve(process.cwd(), 'scripts/agar-processing');
  }

  /**
   * Start a new refresh job
   */
  async startRefresh(options: RefreshOptions = {}): Promise<string> {
    // Check if a job is already running
    if (currentJob && jobs.get(currentJob)?.phase !== 'completed' &&
        jobs.get(currentJob)?.phase !== 'failed' &&
        jobs.get(currentJob)?.phase !== 'cancelled') {
      throw new Error(`A refresh job is already running: ${currentJob}`);
    }

    const jobId = this.generateJobId();
    const now = new Date().toISOString();

    const job: JobStatus = {
      jobId,
      phase: 'pending',
      progress: 0,
      message: 'Initializing refresh...',
      startedAt: now,
      updatedAt: now
    };

    jobs.set(jobId, job);
    currentJob = jobId;

    // Run the refresh asynchronously
    this.runRefresh(jobId, options).catch(error => {
      this.updateJob(jobId, {
        phase: 'failed',
        error: error.message,
        message: `Refresh failed: ${error.message}`
      });
    });

    return jobId;
  }

  /**
   * Get status of a specific job
   */
  getJobStatus(jobId: string): JobStatus | null {
    return jobs.get(jobId) || null;
  }

  /**
   * Get status of current/most recent job
   */
  getCurrentJobStatus(): JobStatus | null {
    if (currentJob) {
      return jobs.get(currentJob) || null;
    }
    return null;
  }

  /**
   * Get all jobs (for history display)
   */
  getAllJobs(): JobStatus[] {
    return Array.from(jobs.values()).sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const job = jobs.get(jobId);
    if (!job) return false;

    if (job.phase === 'completed' || job.phase === 'failed' || job.phase === 'cancelled') {
      return false;
    }

    this.updateJob(jobId, {
      phase: 'cancelled',
      message: 'Job cancelled by user'
    });

    return true;
  }

  /**
   * Check if S3 is configured for refresh operations
   */
  async isS3Configured(): Promise<boolean> {
    return this.s3Service.isConfigured();
  }

  /**
   * List available scrape runs from S3
   */
  async listScrapeRuns(): Promise<ScrapeRunInfo[]> {
    return this.s3Service.listScrapeRuns();
  }

  // Private methods

  private async runRefresh(jobId: string, options: RefreshOptions): Promise<void> {
    try {
      // Phase 1: Select scrape run
      this.updateJob(jobId, { phase: 'pending', progress: 5, message: 'Selecting scrape run...' });

      let scrapeRunPath = options.scrapeRunPath;
      if (!scrapeRunPath) {
        const runs = await this.s3Service.listScrapeRuns();
        const fullRuns = runs.filter(r => r.type === 'FULL');
        if (fullRuns.length === 0) {
          throw new Error('No FULL scrape runs found in S3');
        }
        scrapeRunPath = fullRuns[0].path;
      }

      const runId = path.basename(scrapeRunPath.replace(/\/$/, ''));
      this.updateJob(jobId, { scrapeRunId: runId, message: `Selected scrape run: ${runId}` });

      // Check for cancellation
      if (this.isCancelled(jobId)) return;

      // Phase 2: Download from S3
      this.updateJob(jobId, { phase: 'downloading', progress: 10, message: 'Downloading scrape run from S3...' });

      const downloadResult = await this.s3Service.downloadScrapeRun(scrapeRunPath, (progress) => {
        this.updateJob(jobId, {
          progress: 10 + Math.round(progress.percentComplete * 0.15),
          message: `Downloading: ${progress.percentComplete}% (${progress.downloadedFiles}/${progress.totalFiles} files)`
        });
      });

      const localPath = downloadResult.localPath;

      if (this.isCancelled(jobId)) {
        await this.s3Service.cleanup(localPath);
        return;
      }

      // Phase 3: Backup (always, per plan)
      this.updateJob(jobId, { phase: 'backing_up', progress: 25, message: 'Creating database backup...' });
      const backup = await this.adminService.createBackup();
      this.updateJob(jobId, { backupTimestamp: backup.timestamp });

      if (this.isCancelled(jobId)) {
        await this.s3Service.cleanup(localPath);
        return;
      }

      // Phase 4: Reset databases
      this.updateJob(jobId, { phase: 'resetting', progress: 35, message: 'Resetting databases...' });
      await this.adminService.resetDatabases();

      if (this.isCancelled(jobId)) {
        await this.s3Service.cleanup(localPath);
        return;
      }

      // Phase 5: Process metadata
      logger.info('DEBUG: Starting Phase 5 - process-metadata.ts', { jobId, localPath });
      this.updateJob(jobId, { phase: 'processing_metadata', progress: 45, message: 'Processing metadata (Phase 1)...' });

      try {
        logger.info('DEBUG: About to call runProcessingScript for process-metadata.ts', { jobId });
        await this.runProcessingScript('process-metadata.ts', localPath);
        logger.info('DEBUG: process-metadata.ts completed successfully', { jobId });
      } catch (scriptError: any) {
        logger.error('DEBUG: process-metadata.ts threw an error', {
          jobId,
          error: scriptError.message,
          stack: scriptError.stack
        });
        throw scriptError;
      }

      logger.info('DEBUG: Checking cancellation after Phase 5', { jobId });
      if (this.isCancelled(jobId)) {
        logger.info('DEBUG: Job was cancelled after Phase 5', { jobId });
        await this.s3Service.cleanup(localPath);
        return;
      }

      // Phase 6: Extract PDF metadata
      logger.info('DEBUG: Starting Phase 6 - extract-pdf-metadata.ts', { jobId, localPath });
      this.updateJob(jobId, { phase: 'extracting_pdf_metadata', progress: 60, message: 'Extracting PDF metadata (Phase 2A)...' });

      try {
        logger.info('DEBUG: About to call runProcessingScript for extract-pdf-metadata.ts', { jobId });
        await this.runProcessingScript('extract-pdf-metadata.ts', localPath);
        logger.info('DEBUG: extract-pdf-metadata.ts completed successfully', { jobId });
      } catch (scriptError: any) {
        logger.error('DEBUG: extract-pdf-metadata.ts threw an error', {
          jobId,
          error: scriptError.message,
          stack: scriptError.stack
        });
        throw scriptError;
      }

      if (this.isCancelled(jobId)) {
        await this.s3Service.cleanup(localPath);
        return;
      }

      // Phase 7: Generate embeddings
      this.updateJob(jobId, { phase: 'generating_embeddings', progress: 75, message: 'Generating embeddings (Phase 2B)...' });
      await this.runProcessingScript('generate-pdf-embeddings.ts', localPath);

      if (this.isCancelled(jobId)) {
        await this.s3Service.cleanup(localPath);
        return;
      }

      // Phase 8: Cleanup
      if (!options.skipCleanup) {
        this.updateJob(jobId, { phase: 'cleaning_up', progress: 95, message: 'Cleaning up temporary files...' });
        await this.s3Service.cleanup(localPath);
      }

      // Get final stats
      const stats = await this.adminService.getDatabaseStats();

      // Complete
      this.updateJob(jobId, {
        phase: 'completed',
        progress: 100,
        message: 'Refresh completed successfully!',
        completedAt: new Date().toISOString(),
        stats: {
          entitiesCreated: stats.neo4j.entities,
          relationshipsCreated: stats.neo4j.relationships,
          embeddingsGenerated: stats.postgres.embeddings
        }
      });

      logger.info('Refresh job completed', { jobId, stats });

    } catch (error: any) {
      logger.error('Refresh job failed', { jobId, error: error.message });
      throw error;
    }
  }

  private async runProcessingScript(scriptName: string, scrapeRunPath: string): Promise<void> {
    const scriptPath = path.join(this.scriptsDir, scriptName);

    const envVars = [
      `AGAR_SCRAPE_RUN_DIR="${scrapeRunPath}"`,
      `API_URL="${process.env.API_URL || 'http://localhost:3000'}"`,
      `MEMENTO_API_KEY="${process.env.MEMENTO_API_KEY || ''}"`,
      `BATCH_SIZE="${process.env.BATCH_SIZE || '10'}"`,
      `BATCH_DELAY="${process.env.BATCH_DELAY || '1000'}"`,
      `VOYAGE_API_KEY="${process.env.VOYAGE_API_KEY || ''}"`,
      `OPENAI_API_KEY="${process.env.OPENAI_API_KEY || ''}"`,
      `NODE_OPTIONS="--max-old-space-size=1536"`
    ].join(' ');

    const command = `${envVars} npx tsx ${scriptPath} --full-only`;

    logger.info('Running processing script', {
      scriptName,
      scriptPath,
      scrapeRunPath,
      scriptsDir: this.scriptsDir,
      command: command.substring(0, 200) + '...' // Log partial command for debugging
    });

    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer
        timeout: 30 * 60 * 1000, // 30 minute timeout
        cwd: this.scriptsDir // Set working directory to scripts dir for relative imports
      });

      if (stderr && !stderr.includes('ExperimentalWarning')) {
        logger.warn('Processing script warnings', { scriptName, stderr: stderr.substring(0, 1000) });
      }

      logger.info('Processing script completed successfully', {
        scriptName,
        stdoutLength: stdout?.length || 0
      });
    } catch (error: any) {
      // Extract detailed error info
      const errorDetails = {
        scriptName,
        message: error.message,
        code: error.code,
        signal: error.signal,
        killed: error.killed,
        cmd: error.cmd?.substring(0, 200),
        stdout: error.stdout?.substring(0, 2000),
        stderr: error.stderr?.substring(0, 2000)
      };

      logger.error('Processing script failed with details', errorDetails);

      // Include stderr in the error message for better debugging
      const errorMsg = error.stderr
        ? `${scriptName} failed: ${error.stderr.substring(0, 500)}`
        : `${scriptName} failed: ${error.message}`;

      throw new Error(errorMsg);
    }
  }

  private updateJob(jobId: string, updates: Partial<JobStatus>): void {
    const job = jobs.get(jobId);
    if (job) {
      Object.assign(job, updates, { updatedAt: new Date().toISOString() });
      jobs.set(jobId, job);
    }
  }

  private isCancelled(jobId: string): boolean {
    const job = jobs.get(jobId);
    return job?.phase === 'cancelled';
  }

  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

/**
 * Create ProcessingService from environment variables
 */
export function createProcessingServiceFromEnv(): ProcessingService {
  const adminService = createAdminServiceFromEnv();
  const s3Service = createS3ServiceFromEnv();
  return new ProcessingService(adminService, s3Service);
}
