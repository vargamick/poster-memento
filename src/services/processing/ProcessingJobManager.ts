/**
 * Processing Job Manager
 *
 * Manages job state for processing operations.
 * In-memory storage (jobs lost on restart per design decision).
 */

import { logger } from '../../utils/logger.js';
import type {
  ProcessingJob,
  JobType,
  JobStatus,
  JobProgress,
  BatchStats
} from './types.js';

// In-memory job storage
const jobs: Map<string, ProcessingJob> = new Map();

// Track current running job per type
const currentJobs: Map<JobType, string> = new Map();

export class ProcessingJobManager {
  /**
   * Generate a unique job ID
   */
  generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Create a new job
   */
  createJob(type: JobType, metadata?: Record<string, unknown>): ProcessingJob {
    const jobId = this.generateJobId();
    const now = new Date().toISOString();

    const job: ProcessingJob = {
      jobId,
      type,
      status: 'pending',
      progress: {
        total: 0,
        processed: 0,
        failed: 0,
        percentComplete: 0
      },
      startedAt: now,
      updatedAt: now,
      metadata
    };

    jobs.set(jobId, job);
    currentJobs.set(type, jobId);

    logger.info('Processing job created', { jobId, type });

    return job;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): ProcessingJob | null {
    return jobs.get(jobId) || null;
  }

  /**
   * Get current job for a specific type
   */
  getCurrentJob(type: JobType): ProcessingJob | null {
    const jobId = currentJobs.get(type);
    if (!jobId) return null;
    return jobs.get(jobId) || null;
  }

  /**
   * Get all jobs (sorted by start time, newest first)
   */
  getAllJobs(): ProcessingJob[] {
    return Array.from(jobs.values()).sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  /**
   * Get jobs by type
   */
  getJobsByType(type: JobType): ProcessingJob[] {
    return this.getAllJobs().filter(job => job.type === type);
  }

  /**
   * Update job status
   */
  updateStatus(jobId: string, status: JobStatus, error?: string): void {
    const job = jobs.get(jobId);
    if (!job) {
      logger.warn('Attempted to update non-existent job', { jobId });
      return;
    }

    job.status = status;
    job.updatedAt = new Date().toISOString();

    if (error) {
      job.error = error;
    }

    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      job.completedAt = new Date().toISOString();
    }

    jobs.set(jobId, job);

    logger.info('Job status updated', { jobId, status, error });
  }

  /**
   * Update job progress
   */
  updateProgress(
    jobId: string,
    progress: Partial<JobProgress>
  ): void {
    const job = jobs.get(jobId);
    if (!job) {
      logger.warn('Attempted to update progress for non-existent job', { jobId });
      return;
    }

    // Merge progress updates
    if (progress.total !== undefined) {
      job.progress.total = progress.total;
    }
    if (progress.processed !== undefined) {
      job.progress.processed = progress.processed;
    }
    if (progress.failed !== undefined) {
      job.progress.failed = progress.failed;
    }

    // Recalculate percentage
    if (job.progress.total > 0) {
      job.progress.percentComplete = Math.round(
        (job.progress.processed / job.progress.total) * 100
      );
    }

    job.updatedAt = new Date().toISOString();
    jobs.set(jobId, job);
  }

  /**
   * Increment processed count
   */
  incrementProcessed(jobId: string, count: number = 1): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.progress.processed += count;

    if (job.progress.total > 0) {
      job.progress.percentComplete = Math.round(
        (job.progress.processed / job.progress.total) * 100
      );
    }

    job.updatedAt = new Date().toISOString();
    jobs.set(jobId, job);
  }

  /**
   * Increment failed count
   */
  incrementFailed(jobId: string, count: number = 1): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.progress.failed += count;
    job.updatedAt = new Date().toISOString();
    jobs.set(jobId, job);
  }

  /**
   * Set total items to process
   */
  setTotal(jobId: string, total: number): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.progress.total = total;
    job.updatedAt = new Date().toISOString();
    jobs.set(jobId, job);
  }

  /**
   * Update job metadata
   */
  updateMetadata(jobId: string, metadata: Record<string, unknown>): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.metadata = { ...job.metadata, ...metadata };
    job.updatedAt = new Date().toISOString();
    jobs.set(jobId, job);
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): boolean {
    const job = jobs.get(jobId);
    if (!job) return false;

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      return false;
    }

    this.updateStatus(jobId, 'cancelled');
    return true;
  }

  /**
   * Check if a job is cancelled
   */
  isCancelled(jobId: string): boolean {
    const job = jobs.get(jobId);
    return job?.status === 'cancelled';
  }

  /**
   * Check if there's a running job of a specific type
   */
  hasRunningJob(type: JobType): boolean {
    const job = this.getCurrentJob(type);
    return job !== null && (job.status === 'pending' || job.status === 'running');
  }

  /**
   * Complete a job successfully
   */
  completeJob(jobId: string, stats?: BatchStats): void {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.updatedAt = job.completedAt;
    job.progress.percentComplete = 100;

    if (stats) {
      job.metadata = { ...job.metadata, stats };
    }

    jobs.set(jobId, job);
    logger.info('Job completed', { jobId, stats });
  }

  /**
   * Fail a job with an error
   */
  failJob(jobId: string, error: string): void {
    this.updateStatus(jobId, 'failed', error);
  }

  /**
   * Clean up old completed/failed jobs (optional, for memory management)
   */
  cleanupOldJobs(maxAge: number = 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAge;

    for (const [jobId, job] of jobs) {
      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
        const completedTime = job.completedAt ? new Date(job.completedAt).getTime() : 0;
        if (completedTime < cutoff) {
          jobs.delete(jobId);
          logger.debug('Cleaned up old job', { jobId });
        }
      }
    }
  }
}

// Export singleton instance
export const processingJobManager = new ProcessingJobManager();
