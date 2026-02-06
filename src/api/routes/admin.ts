import { Router } from 'express';
import { asyncHandler, ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import type { AdminService } from '../../services/AdminService.js';
import type { S3Service } from '../../services/S3Service.js';
import type { ProcessingService } from '../../services/ProcessingService.js';
import type { KnowledgeGraphManager } from '../../KnowledgeGraphManager.js';
import { ensurePosterTypesSeeded, resetPosterTypeSeedCache } from '../../utils/ensurePosterTypes.js';
import { logger } from '../../utils/logger.js';

/**
 * Create admin routes
 *
 * All routes require API key authentication (handled by parent middleware).
 * Destructive operations require additional confirmation header.
 */
export function createAdminRoutes(
  adminService: AdminService,
  s3Service: S3Service,
  processingService: ProcessingService,
  knowledgeGraphManager?: KnowledgeGraphManager
): Router {
  const router = Router();

  // ============================================
  // Debug Endpoints
  // ============================================

  /**
   * GET /admin/debug/scripts - Debug script directory structure
   */
  router.get('/debug/scripts', asyncHandler(async (req, res) => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const isDocker = process.env.NODE_ENV === 'production' && process.cwd().startsWith('/app');
    const scriptsDir = isDocker
      ? '/app/instance/scripts'
      : path.default.resolve(process.cwd(), 'scripts/agar-processing');

    const results: any = {
      isDocker,
      cwd: process.cwd(),
      scriptsDir,
      nodeVersion: process.version,
      env: {
        NODE_ENV: process.env.NODE_ENV,
        API_URL: process.env.API_URL,
        VOYAGE_API_KEY: process.env.VOYAGE_API_KEY ? 'set' : 'not set'
      }
    };

    try {
      // List scripts directory
      const scriptsDirExists = await fs.stat(scriptsDir).then(() => true).catch(() => false);
      results.scriptsDirExists = scriptsDirExists;

      if (scriptsDirExists) {
        results.scriptsContents = await fs.readdir(scriptsDir);

        // Check utils directory
        const utilsDir = path.default.join(scriptsDir, 'utils');
        const utilsDirExists = await fs.stat(utilsDir).then(() => true).catch(() => false);
        results.utilsDirExists = utilsDirExists;
        if (utilsDirExists) {
          results.utilsContents = await fs.readdir(utilsDir);
        }
      }

      // Check processing directory (for CatalogManager import)
      const processingDir = isDocker ? '/app/instance/processing' : path.default.resolve(process.cwd(), 'scripts/processing');
      const processingDirExists = await fs.stat(processingDir).then(() => true).catch(() => false);
      results.processingDir = processingDir;
      results.processingDirExists = processingDirExists;

      if (processingDirExists) {
        results.processingContents = await fs.readdir(processingDir);

        const coreDir = path.default.join(processingDir, 'core');
        const coreDirExists = await fs.stat(coreDir).then(() => true).catch(() => false);
        results.coreDirExists = coreDirExists;
        if (coreDirExists) {
          results.coreContents = await fs.readdir(coreDir);
        }

        const typesDir = path.default.join(processingDir, 'types');
        const typesDirExists = await fs.stat(typesDir).then(() => true).catch(() => false);
        results.typesDirExists = typesDirExists;
        if (typesDirExists) {
          results.typesContents = await fs.readdir(typesDir);
        }
      }

      // Try running a simple tsx command to verify tsx works
      try {
        const { stdout } = await execAsync('npx tsx --version', { timeout: 10000 });
        results.tsxVersion = stdout.trim();
      } catch (e: any) {
        results.tsxError = e.message;
      }

    } catch (e: any) {
      results.error = e.message;
    }

    res.json(results);
  }));

  /**
   * GET /admin/debug/test-script - Test running a simple script
   */
  router.get('/debug/test-script', asyncHandler(async (req, res) => {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    const results: any = {
      timestamp: new Date().toISOString(),
      tests: []
    };

    // Test 1: Simple echo
    try {
      const { stdout } = await execAsync('echo "test"', { timeout: 5000 });
      results.tests.push({ name: 'echo', success: true, output: stdout.trim() });
    } catch (e: any) {
      results.tests.push({ name: 'echo', success: false, error: e.message });
    }

    // Test 2: Check if tsx can parse a simple script
    try {
      const { stdout, stderr } = await execAsync(
        'npx tsx -e "console.log(JSON.stringify({ok: true}))"',
        { timeout: 30000 }
      );
      results.tests.push({ name: 'tsx-inline', success: true, output: stdout.trim(), stderr: stderr?.substring(0, 500) });
    } catch (e: any) {
      results.tests.push({ name: 'tsx-inline', success: false, error: e.message, stderr: e.stderr?.substring(0, 500) });
    }

    // Test 3: Check if process-metadata.ts can at least be parsed (dry import check)
    try {
      const { stdout, stderr } = await execAsync(
        'npx tsx -e "import(\\"/app/instance/scripts/process-metadata.ts\\").then(() => console.log(\\"import ok\\")).catch(e => console.error(e.message))"',
        { timeout: 60000, cwd: '/app/instance/scripts' }
      );
      results.tests.push({ name: 'import-check', success: true, output: stdout.trim(), stderr: stderr?.substring(0, 500) });
    } catch (e: any) {
      results.tests.push({ name: 'import-check', success: false, error: e.message, stderr: e.stderr?.substring(0, 500) });
    }

    res.json(results);
  }));

  // ============================================
  // Health & Stats Endpoints
  // ============================================

  /**
   * GET /admin/health - Extended health check for admin
   */
  router.get('/health', asyncHandler(async (req, res) => {
    const health = await adminService.getHealthStatus();
    const s3Configured = await s3Service.isConfigured();

    res.json({
      ...health,
      s3: {
        configured: s3Configured
      }
    });
  }));

  /**
   * GET /admin/stats - Database statistics
   */
  router.get('/stats', asyncHandler(async (req, res) => {
    const stats = await adminService.getDatabaseStats();
    res.json({
      data: stats
    });
  }));

  // ============================================
  // Reset Endpoints
  // ============================================

  /**
   * GET /admin/reset/preview - Preview what will be deleted
   */
  router.get('/reset/preview', asyncHandler(async (req, res) => {
    const preview = await adminService.getResetPreview();
    res.json({
      data: preview,
      warning: 'This operation will permanently delete all data. A backup will be created automatically.'
    });
  }));

  /**
   * POST /admin/seed - Seed required entities (PosterTypes)
   *
   * Creates PosterType entities if they don't exist. Safe to call multiple times.
   * Use this after a database reset or on a fresh database.
   */
  router.post('/seed', asyncHandler(async (req, res) => {
    if (!knowledgeGraphManager) {
      throw new ValidationError('Knowledge graph manager not available for seeding');
    }

    logger.info('Seeding PosterType entities...');
    resetPosterTypeSeedCache(); // Clear cache to force seeding
    const seedResult = await ensurePosterTypesSeeded(knowledgeGraphManager, true);

    res.json({
      data: {
        success: true,
        posterTypesCreated: seedResult.created,
        posterTypesExisting: seedResult.existing,
        totalPosterTypes: seedResult.created + seedResult.existing
      },
      message: seedResult.created > 0
        ? `Created ${seedResult.created} PosterType entities.`
        : 'All PosterType entities already exist.'
    });
  }));

  /**
   * POST /admin/reset - Reset databases (creates backup first)
   *
   * Requires header: x-admin-confirm: RESET
   */
  router.post('/reset', asyncHandler(async (req, res) => {
    // Require confirmation header
    const confirmHeader = req.headers['x-admin-confirm'];
    if (confirmHeader !== 'RESET') {
      throw new ValidationError(
        'Database reset requires confirmation. Set header: x-admin-confirm: RESET'
      );
    }

    const result = await adminService.resetDatabases();

    // Reseed PosterType entities if knowledgeGraphManager is available
    let seedResult = { created: 0, existing: 0 };
    if (knowledgeGraphManager) {
      logger.info('Reseeding PosterType entities after reset...');
      resetPosterTypeSeedCache(); // Clear cache so seeding runs
      seedResult = await ensurePosterTypesSeeded(knowledgeGraphManager, true);
      logger.info('Seeding complete', { posterTypesCreated: seedResult.created });
    }

    res.json({
      data: {
        success: result.success,
        backupTimestamp: result.backupTimestamp,
        previousStats: result.previousStats,
        newStats: result.newStats,
        duration: result.duration,
        seeded: {
          posterTypesCreated: seedResult.created
        }
      },
      message: 'Database reset complete. Backup created before reset.'
    });
  }));

  // ============================================
  // S3 Scrape Run Endpoints
  // ============================================

  /**
   * GET /admin/s3/scrape-runs - List available scrape runs
   */
  router.get('/s3/scrape-runs', asyncHandler(async (req, res) => {
    const configured = await s3Service.isConfigured();
    if (!configured) {
      throw new ValidationError('S3 is not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    }

    const runs = await processingService.listScrapeRuns();

    res.json({
      data: runs.map(run => ({
        runId: run.runId,
        timestamp: run.timestamp.toISOString(),
        type: run.type,
        path: run.path,
        files: run.files,
        size: run.size,
        sizeFormatted: run.sizeFormatted
      })),
      count: runs.length
    });
  }));

  /**
   * GET /admin/s3/scrape-runs/:id - Get details of specific scrape run
   */
  router.get('/s3/scrape-runs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;

    const configured = await s3Service.isConfigured();
    if (!configured) {
      throw new ValidationError('S3 is not configured');
    }

    // Find the run by ID
    const runs = await processingService.listScrapeRuns();
    const run = runs.find(r => r.runId === id);

    if (!run) {
      throw new NotFoundError(`Scrape run not found: ${id}`);
    }

    res.json({
      data: {
        runId: run.runId,
        timestamp: run.timestamp.toISOString(),
        type: run.type,
        path: run.path,
        files: run.files,
        size: run.size,
        sizeFormatted: run.sizeFormatted
      }
    });
  }));

  // ============================================
  // Refresh/Processing Endpoints
  // ============================================

  /**
   * POST /admin/refresh - Start a full refresh workflow
   *
   * Body (optional):
   * - scrapeRunPath: Path to specific scrape run (defaults to most recent FULL)
   * - skipCleanup: Keep downloaded files after processing
   */
  router.post('/refresh', asyncHandler(async (req, res) => {
    const { scrapeRunPath, skipCleanup } = req.body || {};

    // Check if S3 is configured
    const s3Configured = await processingService.isS3Configured();
    if (!s3Configured) {
      throw new ValidationError('S3 is not configured. Set AWS credentials to enable refresh.');
    }

    // Check if job already running
    const currentJob = processingService.getCurrentJobStatus();
    if (currentJob && !['completed', 'failed', 'cancelled'].includes(currentJob.phase)) {
      throw new ValidationError(`A refresh job is already running: ${currentJob.jobId}`);
    }

    const jobId = await processingService.startRefresh({
      scrapeRunPath,
      skipCleanup: skipCleanup === true
    });

    res.status(202).json({
      data: {
        jobId,
        message: 'Refresh job started',
        statusUrl: `/api/v1/admin/refresh/jobs/${jobId}`
      }
    });
  }));

  /**
   * GET /admin/refresh/status - Get current job status
   */
  router.get('/refresh/status', asyncHandler(async (req, res) => {
    const job = processingService.getCurrentJobStatus();

    if (!job) {
      res.json({
        data: null,
        message: 'No refresh job has been started'
      });
      return;
    }

    res.json({
      data: job
    });
  }));

  /**
   * GET /admin/refresh/jobs - List all jobs (history)
   */
  router.get('/refresh/jobs', asyncHandler(async (req, res) => {
    const jobs = processingService.getAllJobs();

    res.json({
      data: jobs,
      count: jobs.length
    });
  }));

  /**
   * GET /admin/refresh/jobs/:id - Get specific job status
   */
  router.get('/refresh/jobs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const job = processingService.getJobStatus(id);

    if (!job) {
      throw new NotFoundError(`Job not found: ${id}`);
    }

    res.json({
      data: job
    });
  }));

  /**
   * DELETE /admin/refresh/jobs/:id - Cancel a running job
   */
  router.delete('/refresh/jobs/:id', asyncHandler(async (req, res) => {
    const { id } = req.params;
    const cancelled = await processingService.cancelJob(id);

    if (!cancelled) {
      throw new ValidationError(`Cannot cancel job ${id}. It may have already completed or doesn't exist.`);
    }

    res.json({
      data: {
        jobId: id,
        cancelled: true
      },
      message: 'Job cancellation requested'
    });
  }));

  return router;
}
