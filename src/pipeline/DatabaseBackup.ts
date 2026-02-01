import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import neo4j, { Driver } from 'neo4j-driver';
import pkg from 'pg';
const { Pool } = pkg;

/**
 * Database Backup for Poster Memento
 *
 * Creates backups of Neo4j and PostgreSQL databases before major operations.
 * Backups are stored with timestamps for easy restoration if needed.
 */

export interface BackupConfig {
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  neo4jDatabase: string;
  postgresHost: string;
  postgresPort: number;
  postgresUser: string;
  postgresPassword: string;
  postgresDatabase: string;
  backupDirectory: string;
  compress: boolean;
}

export interface BackupResult {
  timestamp: string;
  neo4jBackupPath: string;
  postgresBackupPath: string;
  manifestPath: string;
  neo4jStats: DatabaseStats;
  postgresStats: PostgresStats;
}

export interface DatabaseStats {
  entities: number;
  relationships: number;
  labels: string[];
  labelCount: number;
}

export interface PostgresStats {
  embeddings: number;
  tableSize: string;
}

export class DatabaseBackup {
  private config: BackupConfig;
  private neo4jDriver: Driver | null = null;
  private pgPool: pkg.Pool | null = null;
  private timestamp: string;

  constructor(config: BackupConfig) {
    this.config = config;
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                     new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '');
  }

  /**
   * Main backup process
   */
  async backup(): Promise<BackupResult> {
    console.log('=== Poster Memento Database Backup ===\n');
    console.log(`Timestamp: ${this.timestamp}\n`);

    try {
      // Ensure backup directory exists
      await this.ensureBackupDirectory();

      // Get database stats before backup
      console.log('Collecting database statistics...');
      const stats = await this.getDatabaseStats();
      this.printStats(stats);

      console.log('\n' + '='.repeat(60));
      console.log('STARTING BACKUP');
      console.log('='.repeat(60) + '\n');

      // Backup Neo4j
      console.log('Step 1: Backing up Neo4j...');
      const neo4jBackupPath = await this.backupNeo4j();
      console.log(`  Done: ${path.basename(neo4jBackupPath)}\n`);

      // Backup PostgreSQL
      console.log('Step 2: Backing up PostgreSQL...');
      const postgresBackupPath = await this.backupPostgres();
      console.log(`  Done: ${path.basename(postgresBackupPath)}\n`);

      // Create backup manifest
      const manifestPath = await this.writeManifest({
        timestamp: this.timestamp,
        neo4jBackupPath,
        postgresBackupPath,
        neo4jStats: stats.neo4j,
        postgresStats: stats.postgres
      });

      const result: BackupResult = {
        timestamp: this.timestamp,
        neo4jBackupPath,
        postgresBackupPath,
        manifestPath,
        neo4jStats: stats.neo4j,
        postgresStats: stats.postgres
      };

      console.log('='.repeat(60));
      console.log('BACKUP COMPLETE');
      console.log('='.repeat(60));
      console.log(`\nBackup location: ${this.config.backupDirectory}`);
      console.log(`\nTo restore this backup:`);
      console.log(`  npx tsx scripts/admin/restore-databases.ts ${this.timestamp}`);

      return result;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('\nBackup failed:', errorMessage);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Ensure backup directory exists
   */
  private async ensureBackupDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.backupDirectory, { recursive: true });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create backup directory: ${errorMessage}`);
    }
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats(): Promise<{ neo4j: DatabaseStats; postgres: PostgresStats }> {
    await this.initConnections();

    const neo4jSession = this.neo4jDriver!.session({ database: this.config.neo4jDatabase });

    try {
      // Neo4j stats
      const entityCountResult = await neo4jSession.run(
        'MATCH (n) RETURN count(n) as count'
      );
      const entityCount = entityCountResult.records[0].get('count').toNumber();

      const relCountResult = await neo4jSession.run(
        'MATCH ()-[r]->() RETURN count(r) as count'
      );
      const relCount = relCountResult.records[0].get('count').toNumber();

      const labelsResult = await neo4jSession.run('CALL db.labels()');
      const labels = labelsResult.records.map(r => r.get('label'));

      // PostgreSQL stats
      let postgresStats: PostgresStats = { embeddings: 0, tableSize: '0 bytes' };
      try {
        const pgResult = await this.pgPool!.query(
          `SELECT
            COUNT(*) as count,
            pg_size_pretty(pg_total_relation_size('entity_embeddings')) as size
          FROM entity_embeddings`
        );
        postgresStats = {
          embeddings: parseInt(pgResult.rows[0].count),
          tableSize: pgResult.rows[0].size || '0 bytes'
        };
      } catch (pgError) {
        // Table might not exist yet
        console.log('  Note: entity_embeddings table not found or empty');
      }

      return {
        neo4j: {
          entities: entityCount,
          relationships: relCount,
          labels: labels,
          labelCount: labels.length
        },
        postgres: postgresStats
      };
    } finally {
      await neo4jSession.close();
    }
  }

  /**
   * Print statistics
   */
  private printStats(stats: { neo4j: DatabaseStats; postgres: PostgresStats }): void {
    console.log('Current Database State:');
    console.log('  Neo4j:');
    console.log(`    Entities: ${stats.neo4j.entities.toLocaleString()}`);
    console.log(`    Relationships: ${stats.neo4j.relationships.toLocaleString()}`);
    console.log(`    Entity Types: ${stats.neo4j.labelCount}`);
    if (stats.neo4j.labels.length > 0) {
      console.log(`      ${stats.neo4j.labels.join(', ')}`);
    }
    console.log('  PostgreSQL:');
    console.log(`    Embeddings: ${stats.postgres.embeddings.toLocaleString()}`);
    console.log(`    Table Size: ${stats.postgres.tableSize}`);
  }

  /**
   * Backup Neo4j database
   */
  private async backupNeo4j(): Promise<string> {
    await this.initConnections();
    const session = this.neo4jDriver!.session({ database: this.config.neo4jDatabase });

    try {
      const backupPath = path.join(
        this.config.backupDirectory,
        `neo4j_backup_${this.timestamp}.json`
      );

      // Export all nodes and relationships
      console.log('  Exporting entities...');
      const nodesResult = await session.run('MATCH (n) RETURN n');
      const nodes = nodesResult.records.map(record => {
        const node = record.get('n');
        return {
          id: node.identity.toNumber(),
          labels: node.labels,
          properties: node.properties
        };
      });

      console.log('  Exporting relationships...');
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

      // Write backup file
      const backup = {
        timestamp: this.timestamp,
        database: this.config.neo4jDatabase,
        nodes,
        relationships,
        nodeCount: nodes.length,
        relationshipCount: relationships.length
      };

      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));

      // Compress if requested
      if (this.config.compress) {
        console.log('  Compressing backup...');
        execSync(`gzip -f "${backupPath}"`);
        return backupPath + '.gz';
      }

      return backupPath;

    } finally {
      await session.close();
    }
  }

  /**
   * Backup PostgreSQL database
   */
  private async backupPostgres(): Promise<string> {
    await this.initConnections();

    const backupPath = path.join(
      this.config.backupDirectory,
      `postgres_backup_${this.timestamp}.sql`
    );

    try {
      // Export embeddings table
      console.log('  Exporting entity_embeddings table...');

      let sql = `-- PostgreSQL Backup: ${this.timestamp}\n`;
      sql += `-- Database: ${this.config.postgresDatabase}\n`;
      sql += `-- Table: entity_embeddings\n\n`;
      sql += `TRUNCATE TABLE entity_embeddings;\n\n`;

      try {
        const result = await this.pgPool!.query(
          'SELECT * FROM entity_embeddings ORDER BY id'
        );

        for (const row of result.rows) {
          const embedding = JSON.stringify(row.embedding);
          const metadata = JSON.stringify(row.metadata);
          const entityName = row.entity_name ? row.entity_name.replace(/'/g, "''") : '';
          sql += `INSERT INTO entity_embeddings (entity_name, embedding, metadata, created_at) VALUES `;
          sql += `('${entityName}', '${embedding}', '${metadata}', '${row.created_at}');\n`;
        }
      } catch (pgError) {
        // Table might not exist yet
        sql += `-- Note: entity_embeddings table was empty or did not exist\n`;
      }

      await fs.writeFile(backupPath, sql);

      // Compress if requested
      if (this.config.compress) {
        console.log('  Compressing backup...');
        execSync(`gzip -f "${backupPath}"`);
        return backupPath + '.gz';
      }

      return backupPath;

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`PostgreSQL backup failed: ${errorMessage}`);
    }
  }

  /**
   * Write backup manifest
   */
  private async writeManifest(data: Omit<BackupResult, 'manifestPath'>): Promise<string> {
    const manifestPath = path.join(
      this.config.backupDirectory,
      `backup_manifest_${this.timestamp}.json`
    );

    const manifest: BackupResult = { ...data, manifestPath };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return manifestPath;
  }

  /**
   * Initialize database connections
   */
  private async initConnections(): Promise<void> {
    if (!this.neo4jDriver) {
      this.neo4jDriver = neo4j.driver(
        this.config.neo4jUri,
        neo4j.auth.basic(this.config.neo4jUser, this.config.neo4jPassword)
      );
      await this.neo4jDriver.verifyConnectivity();
    }

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

  /**
   * Cleanup connections
   */
  private async cleanup(): Promise<void> {
    if (this.neo4jDriver) {
      await this.neo4jDriver.close();
      this.neo4jDriver = null;
    }

    if (this.pgPool) {
      await this.pgPool.end();
      this.pgPool = null;
    }
  }
}

/**
 * Get backup configuration from environment
 */
export function getBackupConfigFromEnv(): BackupConfig {
  return {
    neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7693',
    neo4jUser: process.env.NEO4J_USERNAME || 'neo4j',
    neo4jPassword: process.env.NEO4J_PASSWORD || '',
    neo4jDatabase: process.env.NEO4J_DATABASE || 'neo4j',
    postgresHost: process.env.POSTGRES_HOST || 'localhost',
    postgresPort: parseInt(process.env.POSTGRES_PORT || '5440'),
    postgresUser: process.env.POSTGRES_USER || 'posters',
    postgresPassword: process.env.POSTGRES_PASSWORD || '',
    postgresDatabase: process.env.POSTGRES_DB || 'posters',
    backupDirectory: process.env.BACKUP_DIRECTORY || './backups',
    compress: false
  };
}
