import { Pool } from 'pg';
import type { PostgresConfig } from './PostgresConfig.js';
import { logger } from '../../utils/logger.js';

/**
 * Manages PostgreSQL database connections using connection pooling
 */
export class PostgresConnectionManager {
  private pool: InstanceType<typeof Pool> | null = null;
  private readonly config: PostgresConfig;

  constructor(config: PostgresConfig) {
    this.config = config;
  }

  /**
   * Get or create the connection pool
   */
  getPool(): InstanceType<typeof Pool> {
    if (!this.pool) {
      this.pool = new Pool({
        host: this.config.host,
        port: this.config.port,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
        ssl: this.config.ssl,
        max: this.config.max || 20,
        idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000,
      });

      // Handle pool errors
      this.pool.on('error', (err) => {
        logger.error('Unexpected error on idle PostgreSQL client', err);
      });

      logger.info('PostgreSQL connection pool created', {
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
      });
    }

    return this.pool;
  }

  /**
   * Execute a query using a client from the pool
   */
  async query(text: string, params?: any[]): Promise<any> {
    const pool = this.getPool();
    return await pool.query(text, params);
  }

  /**
   * Get a client from the pool for transaction management
   */
  async getClient(): Promise<any> {
    const pool = this.getPool();
    return await pool.connect();
  }

  /**
   * Test the database connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW()');
      logger.info('PostgreSQL connection test successful', {
        serverTime: result.rows[0].now,
      });
      return true;
    } catch (error) {
      logger.error('PostgreSQL connection test failed', error);
      return false;
    }
  }

  /**
   * Close all connections in the pool
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      logger.info('PostgreSQL connection pool closed');
    }
  }
}
