#!/usr/bin/env node
/**
 * Database Backup Script for Poster Memento
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
export declare class DatabaseBackup {
    private config;
    private neo4jDriver;
    private pgPool;
    private timestamp;
    constructor(config: BackupConfig);
    /**
     * Main backup process
     */
    backup(): Promise<BackupResult>;
    /**
     * Ensure backup directory exists
     */
    private ensureBackupDirectory;
    /**
     * Get database statistics
     */
    getDatabaseStats(): Promise<{
        neo4j: DatabaseStats;
        postgres: PostgresStats;
    }>;
    /**
     * Print statistics
     */
    private printStats;
    /**
     * Backup Neo4j database
     */
    private backupNeo4j;
    /**
     * Backup PostgreSQL database
     */
    private backupPostgres;
    /**
     * Write backup manifest
     */
    private writeManifest;
    /**
     * Initialize database connections
     */
    private initConnections;
    /**
     * Cleanup connections
     */
    private cleanup;
}
/**
 * Get backup configuration from environment
 */
export declare function getBackupConfigFromEnv(): BackupConfig;
