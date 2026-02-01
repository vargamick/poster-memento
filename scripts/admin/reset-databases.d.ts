#!/usr/bin/env node
/**
 * Database Reset Script for Poster Memento
 *
 * Clears all data from Neo4j and PostgreSQL databases while preserving schemas.
 * Use this to start fresh before processing a new set of posters.
 *
 * WARNING: This operation cannot be undone!
 */
export interface ResetConfig {
    neo4jUri: string;
    neo4jUser: string;
    neo4jPassword: string;
    neo4jDatabase: string;
    postgresHost: string;
    postgresPort: number;
    postgresUser: string;
    postgresPassword: string;
    postgresDatabase: string;
    skipConfirmation: boolean;
}
export interface ResetStats {
    neo4j: {
        entities: number;
        relationships: number;
        labels: string[];
    };
    postgres: {
        embeddings: number;
        tableSize: string;
    };
}
export interface ResetResult {
    success: boolean;
    beforeStats: ResetStats;
    afterStats: ResetStats;
    timestamp: string;
}
export declare class DatabaseResetter {
    private config;
    private neo4jDriver;
    private pgPool;
    constructor(config: ResetConfig);
    /**
     * Main reset process
     */
    reset(): Promise<ResetResult>;
    /**
     * Get current database statistics
     */
    getDatabaseStats(): Promise<ResetStats>;
    /**
     * Print database statistics
     */
    private printStats;
    /**
     * Confirm reset with user
     */
    private confirmReset;
    /**
     * Reset Neo4j database
     */
    private resetNeo4j;
    /**
     * Reset PostgreSQL database
     */
    private resetPostgres;
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
 * Get reset configuration from environment
 */
export declare function getResetConfigFromEnv(skipConfirmation?: boolean): ResetConfig;
