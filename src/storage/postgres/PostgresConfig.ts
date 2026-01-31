export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /**
   * SSL configuration for PostgreSQL connection
   */
  ssl?: boolean | { rejectUnauthorized?: boolean };
  /**
   * Maximum number of clients in the pool
   */
  max?: number;
  /**
   * Idle timeout in milliseconds
   */
  idleTimeoutMillis?: number;
  /**
   * Connection timeout in milliseconds
   */
  connectionTimeoutMillis?: number;
}
