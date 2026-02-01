#!/usr/bin/env node
import { createInterface } from 'readline';
import neo4j from 'neo4j-driver';
import pkg from 'pg';
const { Pool } = pkg;
export class DatabaseResetter {
    constructor(config) {
        this.neo4jDriver = null;
        this.pgPool = null;
        this.config = config;
    }
    /**
     * Main reset process
     */
    async reset() {
        console.log('=== Poster Memento Database Reset ===\n');
        const timestamp = new Date().toISOString();
        let beforeStats;
        let afterStats;
        try {
            // Get current database stats before reset
            console.log('Fetching current database statistics...\n');
            beforeStats = await this.getDatabaseStats();
            this.printStats(beforeStats);
            // Confirm reset
            if (!this.config.skipConfirmation) {
                const confirmed = await this.confirmReset();
                if (!confirmed) {
                    console.log('\nReset cancelled by user.');
                    return {
                        success: false,
                        beforeStats,
                        afterStats: beforeStats,
                        timestamp
                    };
                }
            }
            console.log('\n' + '='.repeat(60));
            console.log('STARTING DATABASE RESET');
            console.log('='.repeat(60) + '\n');
            // Reset Neo4j
            console.log('Step 1: Resetting Neo4j...');
            await this.resetNeo4j();
            console.log('  Done: Neo4j reset complete\n');
            // Reset PostgreSQL
            console.log('Step 2: Resetting PostgreSQL...');
            await this.resetPostgres();
            console.log('  Done: PostgreSQL reset complete\n');
            // Verify empty state
            console.log('Step 3: Verifying reset...');
            afterStats = await this.getDatabaseStats();
            this.printStats(afterStats);
            console.log('\n' + '='.repeat(60));
            console.log('DATABASE RESET COMPLETE');
            console.log('='.repeat(60));
            console.log('\nDatabases are now empty and ready for fresh data.');
            return {
                success: true,
                beforeStats,
                afterStats,
                timestamp
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('\nReset failed:', errorMessage);
            throw error;
        }
        finally {
            await this.cleanup();
        }
    }
    /**
     * Get current database statistics
     */
    async getDatabaseStats() {
        await this.initConnections();
        const neo4jSession = this.neo4jDriver.session({ database: this.config.neo4jDatabase });
        try {
            // Neo4j stats
            const entityCountResult = await neo4jSession.run('MATCH (n) RETURN count(n) as count');
            const entityCount = entityCountResult.records[0].get('count').toNumber();
            const relCountResult = await neo4jSession.run('MATCH ()-[r]->() RETURN count(r) as count');
            const relCount = relCountResult.records[0].get('count').toNumber();
            const labelsResult = await neo4jSession.run('CALL db.labels()');
            const labels = labelsResult.records.map(r => r.get('label'));
            // PostgreSQL stats
            let postgresStats = { embeddings: 0, tableSize: '0 bytes' };
            try {
                const pgResult = await this.pgPool.query(`SELECT
            COUNT(*) as count,
            pg_size_pretty(pg_total_relation_size('entity_embeddings')) as size
          FROM entity_embeddings`);
                postgresStats = {
                    embeddings: parseInt(pgResult.rows[0].count),
                    tableSize: pgResult.rows[0].size || '0 bytes'
                };
            }
            catch (pgError) {
                // Table might not exist yet
            }
            return {
                neo4j: {
                    entities: entityCount,
                    relationships: relCount,
                    labels: labels
                },
                postgres: postgresStats
            };
        }
        finally {
            await neo4jSession.close();
        }
    }
    /**
     * Print database statistics
     */
    printStats(stats) {
        console.log('Current Database State:');
        console.log('  Neo4j:');
        console.log(`    Entities: ${stats.neo4j.entities.toLocaleString()}`);
        console.log(`    Relationships: ${stats.neo4j.relationships.toLocaleString()}`);
        console.log(`    Entity Types: ${stats.neo4j.labels.length}`);
        if (stats.neo4j.labels.length > 0) {
            console.log(`      ${stats.neo4j.labels.join(', ')}`);
        }
        console.log('  PostgreSQL:');
        console.log(`    Embeddings: ${stats.postgres.embeddings.toLocaleString()}`);
        console.log(`    Table Size: ${stats.postgres.tableSize}`);
    }
    /**
     * Confirm reset with user
     */
    async confirmReset() {
        const rl = createInterface({
            input: process.stdin,
            output: process.stdout
        });
        return new Promise((resolve) => {
            console.log('\n' + '!'.repeat(60));
            console.log('WARNING: This will permanently delete ALL data!');
            console.log('!'.repeat(60));
            rl.question('\nType "DELETE ALL DATA" to confirm: ', (answer) => {
                rl.close();
                resolve(answer.trim() === 'DELETE ALL DATA');
            });
        });
    }
    /**
     * Reset Neo4j database
     */
    async resetNeo4j() {
        await this.initConnections();
        const session = this.neo4jDriver.session({ database: this.config.neo4jDatabase });
        try {
            // Delete all relationships first
            console.log('  Deleting all relationships...');
            await session.run('MATCH ()-[r]->() DELETE r');
            // Delete all nodes
            console.log('  Deleting all entities...');
            await session.run('MATCH (n) DELETE n');
            // Note: We keep indexes and constraints intact
            // They will be needed for the new data
            console.log('  Verifying deletion...');
            const result = await session.run('MATCH (n) RETURN count(n) as count');
            const remaining = result.records[0].get('count').toNumber();
            if (remaining > 0) {
                throw new Error(`Failed to delete all nodes. ${remaining} nodes remaining.`);
            }
        }
        finally {
            await session.close();
        }
    }
    /**
     * Reset PostgreSQL database
     */
    async resetPostgres() {
        await this.initConnections();
        try {
            // Delete all embeddings
            console.log('  Deleting all embeddings...');
            try {
                await this.pgPool.query('TRUNCATE TABLE entity_embeddings');
            }
            catch (truncateError) {
                // Table might not exist, which is fine
                console.log('  Note: entity_embeddings table does not exist or is already empty');
                return;
            }
            // Verify deletion
            console.log('  Verifying deletion...');
            const result = await this.pgPool.query('SELECT COUNT(*) as count FROM entity_embeddings');
            const remaining = parseInt(result.rows[0].count);
            if (remaining > 0) {
                throw new Error(`Failed to delete all embeddings. ${remaining} rows remaining.`);
            }
            // Note: We keep the table structure and indexes intact
            // TRUNCATE is faster than DELETE and resets auto-increment counters
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`PostgreSQL reset failed: ${errorMessage}`);
        }
    }
    /**
     * Initialize database connections
     */
    async initConnections() {
        if (!this.neo4jDriver) {
            this.neo4jDriver = neo4j.driver(this.config.neo4jUri, neo4j.auth.basic(this.config.neo4jUser, this.config.neo4jPassword));
            // Test connection
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
            // Test connection
            await this.pgPool.query('SELECT 1');
        }
    }
    /**
     * Cleanup connections
     */
    async cleanup() {
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
 * Get reset configuration from environment
 */
export function getResetConfigFromEnv(skipConfirmation = false) {
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
        skipConfirmation
    };
}
/**
 * Main execution
 */
async function main() {
    const args = process.argv.slice(2);
    const skipConfirmation = args.includes('--yes') || args.includes('-y');
    // Load configuration from environment
    const config = getResetConfigFromEnv(skipConfirmation);
    // Validate required config
    if (!config.neo4jPassword) {
        console.error('Error: NEO4J_PASSWORD environment variable is required');
        process.exit(1);
    }
    if (!config.postgresPassword) {
        console.error('Error: POSTGRES_PASSWORD environment variable is required');
        process.exit(1);
    }
    const resetter = new DatabaseResetter(config);
    try {
        await resetter.reset();
        process.exit(0);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('\nFATAL ERROR:', errorMessage);
        process.exit(1);
    }
}
// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
//# sourceMappingURL=reset-databases.js.map