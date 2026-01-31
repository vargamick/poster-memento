/**
 * Admin Service
 *
 * Provides database management operations for the admin API.
 * Handles database stats, reset, backup, and health checks.
 */

import neo4j, { Driver } from 'neo4j-driver';
import pkg from 'pg';
const { Pool } = pkg;
type PoolType = InstanceType<typeof Pool>;
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../utils/logger.js';

export interface DatabaseConfig {
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  neo4jDatabase: string;
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
}

export interface DatabaseStats {
  neo4j: {
    entities: number;
    relationships: number;
    labels: string[];
    connected: boolean;
  };
  postgres: {
    embeddings: number;
    tableSize: string;
    connected: boolean;
  };
  timestamp: string;
}

export interface ResetResult {
  success: boolean;
  backupTimestamp?: string;
  previousStats: DatabaseStats;
  newStats: DatabaseStats;
  duration: number;
}

export interface BackupResult {
  timestamp: string;
  neo4jBackupPath: string;
  postgresBackupPath: string;
  stats: DatabaseStats;
}

export interface HealthStatus {
  healthy: boolean;
  neo4j: {
    connected: boolean;
    error?: string;
  };
  postgres: {
    connected: boolean;
    error?: string;
  };
  timestamp: string;
}

export class AdminService {
  private config: DatabaseConfig;
  private backupDirectory: string;
  private neo4jDriver: Driver | null = null;
  private pgPool: PoolType | null = null;

  constructor(config: DatabaseConfig, backupDirectory: string = './backups') {
    this.config = config;
    this.backupDirectory = backupDirectory;
  }

  /**
   * Get current database statistics
   */
  async getDatabaseStats(): Promise<DatabaseStats> {
    const stats: DatabaseStats = {
      neo4j: {
        entities: 0,
        relationships: 0,
        labels: [],
        connected: false
      },
      postgres: {
        embeddings: 0,
        tableSize: '0 bytes',
        connected: false
      },
      timestamp: new Date().toISOString()
    };

    // Get Neo4j stats
    try {
      await this.initNeo4j();
      const session = this.neo4jDriver!.session({ database: this.config.neo4jDatabase });

      try {
        const entityResult = await session.run('MATCH (n) RETURN count(n) as count');
        stats.neo4j.entities = entityResult.records[0].get('count').toNumber();

        const relResult = await session.run('MATCH ()-[r]->() RETURN count(r) as count');
        stats.neo4j.relationships = relResult.records[0].get('count').toNumber();

        const labelsResult = await session.run('CALL db.labels()');
        stats.neo4j.labels = labelsResult.records.map(r => r.get('label'));

        stats.neo4j.connected = true;
      } finally {
        await session.close();
      }
    } catch (error: any) {
      logger.error('Failed to get Neo4j stats', { error: error.message });
    }

    // Get PostgreSQL stats
    try {
      await this.initPostgres();
      const result = await this.pgPool!.query(
        `SELECT
          COUNT(*) as count,
          pg_size_pretty(pg_total_relation_size('entity_embeddings')) as size
        FROM entity_embeddings`
      );
      stats.postgres.embeddings = parseInt(result.rows[0].count);
      stats.postgres.tableSize = result.rows[0].size || '0 bytes';
      stats.postgres.connected = true;
    } catch (error: any) {
      logger.error('Failed to get PostgreSQL stats', { error: error.message });
    }

    return stats;
  }

  /**
   * Get system health status
   */
  async getHealthStatus(): Promise<HealthStatus> {
    const health: HealthStatus = {
      healthy: false,
      neo4j: { connected: false },
      postgres: { connected: false },
      timestamp: new Date().toISOString()
    };

    // Check Neo4j
    try {
      await this.initNeo4j();
      await this.neo4jDriver!.verifyConnectivity();
      health.neo4j.connected = true;
    } catch (error: any) {
      health.neo4j.error = error.message;
    }

    // Check PostgreSQL
    try {
      await this.initPostgres();
      await this.pgPool!.query('SELECT 1');
      health.postgres.connected = true;
    } catch (error: any) {
      health.postgres.error = error.message;
    }

    health.healthy = health.neo4j.connected && health.postgres.connected;
    return health;
  }

  /**
   * Create backup of databases
   */
  async createBackup(): Promise<BackupResult> {
    const timestamp = this.generateTimestamp();
    logger.info('Starting database backup', { timestamp });

    // Ensure backup directory exists
    await fs.mkdir(this.backupDirectory, { recursive: true });

    // Get current stats
    const stats = await this.getDatabaseStats();

    // Backup Neo4j
    const neo4jBackupPath = await this.backupNeo4j(timestamp);

    // Backup PostgreSQL
    const postgresBackupPath = await this.backupPostgres(timestamp);

    // Write manifest
    const result: BackupResult = {
      timestamp,
      neo4jBackupPath,
      postgresBackupPath,
      stats
    };

    const manifestPath = path.join(this.backupDirectory, `backup_manifest_${timestamp}.json`);
    await fs.writeFile(manifestPath, JSON.stringify(result, null, 2));

    logger.info('Database backup complete', { timestamp, neo4jBackupPath, postgresBackupPath });
    return result;
  }

  /**
   * Reset databases (always creates backup first)
   */
  async resetDatabases(): Promise<ResetResult> {
    const startTime = Date.now();
    logger.info('Starting database reset with auto-backup');

    // Get stats before reset
    const previousStats = await this.getDatabaseStats();

    // Create backup first (always)
    const backup = await this.createBackup();

    // Reset Neo4j
    await this.resetNeo4j();

    // Reset PostgreSQL
    await this.resetPostgres();

    // Get stats after reset
    const newStats = await this.getDatabaseStats();

    const duration = Date.now() - startTime;
    logger.info('Database reset complete', { duration, backupTimestamp: backup.timestamp });

    return {
      success: true,
      backupTimestamp: backup.timestamp,
      previousStats,
      newStats,
      duration
    };
  }

  /**
   * Get preview of what will be deleted (for confirmation UI)
   */
  async getResetPreview(): Promise<{
    willDelete: {
      entities: number;
      relationships: number;
      embeddings: number;
    };
    estimatedDuration: string;
  }> {
    const stats = await this.getDatabaseStats();

    // Estimate duration based on data size
    const totalItems = stats.neo4j.entities + stats.neo4j.relationships + stats.postgres.embeddings;
    let estimatedDuration = '< 1 minute';
    if (totalItems > 10000) estimatedDuration = '1-2 minutes';
    if (totalItems > 100000) estimatedDuration = '2-5 minutes';

    return {
      willDelete: {
        entities: stats.neo4j.entities,
        relationships: stats.neo4j.relationships,
        embeddings: stats.postgres.embeddings
      },
      estimatedDuration
    };
  }

  /**
   * Close all connections
   */
  async close(): Promise<void> {
    if (this.neo4jDriver) {
      await this.neo4jDriver.close();
      this.neo4jDriver = null;
    }
    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
  }

  // Private methods

  private async initNeo4j(): Promise<void> {
    if (!this.neo4jDriver) {
      this.neo4jDriver = neo4j.driver(
        this.config.neo4jUri,
        neo4j.auth.basic(this.config.neo4jUser, this.config.neo4jPassword)
      );
      await this.neo4jDriver.verifyConnectivity();
    }
  }

  private async initPostgres(): Promise<void> {
    if (!this.pgPool) {
      this.pgPool = new Pool({
        host: this.config.postgresHost,
        port: this.config.postgresPort,
        user: this.config.postgresUser,
        password: this.config.postgresPassword,
        database: this.config.postgresDatabase,
        max: 5
      });
      await this.pgPool.query('SELECT 1');
    }
  }

  private async resetNeo4j(): Promise<void> {
    await this.initNeo4j();
    const session = this.neo4jDriver!.session({ database: this.config.neo4jDatabase });

    try {
      logger.info('Resetting Neo4j - deleting relationships');
      await session.run('MATCH ()-[r]->() DELETE r');

      logger.info('Resetting Neo4j - deleting entities');
      await session.run('MATCH (n) DELETE n');

      // Verify
      const result = await session.run('MATCH (n) RETURN count(n) as count');
      const remaining = result.records[0].get('count').toNumber();
      if (remaining > 0) {
        throw new Error(`Failed to delete all nodes. ${remaining} remaining.`);
      }
    } finally {
      await session.close();
    }
  }

  private async resetPostgres(): Promise<void> {
    await this.initPostgres();
    logger.info('Resetting PostgreSQL - truncating entity_embeddings');
    await this.pgPool!.query('TRUNCATE TABLE entity_embeddings');

    // Verify
    const result = await this.pgPool!.query('SELECT COUNT(*) as count FROM entity_embeddings');
    const remaining = parseInt(result.rows[0].count);
    if (remaining > 0) {
      throw new Error(`Failed to delete all embeddings. ${remaining} remaining.`);
    }
  }

  private async backupNeo4j(timestamp: string): Promise<string> {
    await this.initNeo4j();
    const session = this.neo4jDriver!.session({ database: this.config.neo4jDatabase });

    try {
      const backupPath = path.join(this.backupDirectory, `neo4j_backup_${timestamp}.json`);

      // Export nodes
      const nodesResult = await session.run('MATCH (n) RETURN n');
      const nodes = nodesResult.records.map(record => {
        const node = record.get('n');
        return {
          id: node.identity.toNumber(),
          labels: node.labels,
          properties: node.properties
        };
      });

      // Export relationships
      const relsResult = await session.run('MATCH ()-[r]->() RETURN r');
      const relationships = relsResult.records.map(record => {
        const rel = record.get('r');
        return {
          id: rel.identity.toNumber(),
          type: rel.type,
          startNode: rel.start.toNumber(),
          endNode: rel.end.toNumber(),
          properties: rel.properties
        };
      });

      const backup = {
        timestamp,
        database: this.config.neo4jDatabase,
        nodes,
        relationships,
        nodeCount: nodes.length,
        relationshipCount: relationships.length
      };

      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));

      // Compress
      execSync(`gzip -f "${backupPath}"`);
      return backupPath + '.gz';
    } finally {
      await session.close();
    }
  }

  private async backupPostgres(timestamp: string): Promise<string> {
    await this.initPostgres();
    const backupPath = path.join(this.backupDirectory, `postgres_backup_${timestamp}.sql`);

    const result = await this.pgPool!.query('SELECT * FROM entity_embeddings ORDER BY id');

    let sql = `-- PostgreSQL Backup: ${timestamp}\n`;
    sql += `-- Database: ${this.config.postgresDatabase}\n`;
    sql += `-- Table: entity_embeddings\n\n`;
    sql += `TRUNCATE TABLE entity_embeddings;\n\n`;

    for (const row of result.rows) {
      const embedding = JSON.stringify(row.embedding);
      const metadata = JSON.stringify(row.metadata);
      const entityName = row.entity_name ? row.entity_name.replace(/'/g, "''") : '';
      sql += `INSERT INTO entity_embeddings (entity_name, embedding, metadata, created_at) VALUES `;
      sql += `('${entityName}', '${embedding}', '${metadata}', '${row.created_at}');\n`;
    }

    await fs.writeFile(backupPath, sql);

    // Compress
    execSync(`gzip -f "${backupPath}"`);
    return backupPath + '.gz';
  }

  private generateTimestamp(): string {
    const now = new Date();
    return now.toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
           now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
  }
}

/**
 * Create AdminService from environment variables
 */
export function createAdminServiceFromEnv(): AdminService {
  const config: DatabaseConfig = {
    neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4jUser: process.env.NEO4J_USER || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD || '',
    neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
    postgresHost: process.env.POSTGRES_HOST || 'localhost',
    postgresPort: parseInt(process.env.POSTGRES_PORT || '5432'),
    postgresUser: process.env.POSTGRES_USER || 'postgres',
    postgresPassword: process.env.POSTGRES_PASSWORD || '',
    postgresDatabase: process.env.POSTGRES_DATABASE || 'memento'
  };

  const backupDirectory = process.env.BACKUP_DIRECTORY || './backups';
  return new AdminService(config, backupDirectory);
}
