/**
 * Cypher Query Validation Utilities
 * Provides validation, sanitization, and error handling for Neo4j Cypher queries
 */

export interface QueryValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  sanitizedQuery?: string;
}

export interface QueryValidationOptions {
  maxLength?: number;
  allowedKeywords?: string[];
  disallowedKeywords?: string[];
  requireSemicolon?: boolean;
}

export class CypherValidator {
  private static readonly DEFAULT_MAX_LENGTH = 10000;
  private static readonly DANGEROUS_KEYWORDS = [
    'DROP DATABASE',
    'CREATE DATABASE',
    'STOP DATABASE',
    'START DATABASE',
    'DROP CONSTRAINT',
    'DROP INDEX'
  ];

  /**
   * Validate a Cypher query for syntax issues and potential problems
   */
  static validateQuery(query: string, options: QueryValidationOptions = {}): QueryValidationResult {
    const result: QueryValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    };

    // Basic null/empty checks
    if (!query || typeof query !== 'string') {
      result.isValid = false;
      result.errors.push('Query cannot be null or empty');
      return result;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      result.isValid = false;
      result.errors.push('Query cannot be empty after trimming');
      return result;
    }

    // Length validation
    const maxLength = options.maxLength || this.DEFAULT_MAX_LENGTH;
    if (trimmedQuery.length > maxLength) {
      result.isValid = false;
      result.errors.push(`Query exceeds maximum length of ${maxLength} characters (${trimmedQuery.length})`);
    }

    // Check for dangerous operations
    const upperQuery = trimmedQuery.toUpperCase();
    for (const dangerous of this.DANGEROUS_KEYWORDS) {
      if (upperQuery.includes(dangerous)) {
        result.warnings.push(`Query contains potentially dangerous operation: ${dangerous}`);
      }
    }

    // Basic syntax validation
    const syntaxErrors = this.checkBasicSyntax(trimmedQuery);
    result.errors.push(...syntaxErrors);

    // Semicolon validation
    if (options.requireSemicolon && !trimmedQuery.endsWith(';')) {
      result.warnings.push('Query should end with a semicolon');
      result.sanitizedQuery = trimmedQuery + ';';
    } else {
      result.sanitizedQuery = trimmedQuery;
    }

    result.isValid = result.errors.length === 0;
    return result;
  }

  /**
   * Check basic syntax issues that commonly cause lexical errors
   */
  private static checkBasicSyntax(query: string): string[] {
    const errors: string[] = [];

    // Check for unmatched quotes
    const singleQuoteCount = (query.match(/'/g) || []).length;
    const doubleQuoteCount = (query.match(/"/g) || []).length;
    const backtickCount = (query.match(/`/g) || []).length;

    if (singleQuoteCount % 2 !== 0) {
      errors.push('Unmatched single quotes detected');
    }
    if (doubleQuoteCount % 2 !== 0) {
      errors.push('Unmatched double quotes detected');
    }
    if (backtickCount % 2 !== 0) {
      errors.push('Unmatched backticks detected');
    }

    // Check for unmatched brackets/parentheses
    const openParen = (query.match(/\(/g) || []).length;
    const closeParen = (query.match(/\)/g) || []).length;
    const openBracket = (query.match(/\[/g) || []).length;
    const closeBracket = (query.match(/\]/g) || []).length;
    const openBrace = (query.match(/{/g) || []).length;
    const closeBrace = (query.match(/}/g) || []).length;

    if (openParen !== closeParen) {
      errors.push(`Unmatched parentheses: ${openParen} open, ${closeParen} close`);
    }
    if (openBracket !== closeBracket) {
      errors.push(`Unmatched square brackets: ${openBracket} open, ${closeBracket} close`);
    }
    if (openBrace !== closeBrace) {
      errors.push(`Unmatched curly braces: ${openBrace} open, ${closeBrace} close`);
    }

    // Check for common syntax issues
    if (query.includes('""')) {
      errors.push('Empty string literals detected - may cause lexical errors');
    }

    // Check for EOF issues (common cause of the original error)
    if (query.trim().endsWith(',')) {
      errors.push('Query ends with comma - may cause EOF errors');
    }

    // Check for incomplete statements
    const upperQuery = query.toUpperCase();
    const incompletePatterns = [
      /\bSET\s*$/,
      /\bWHERE\s*$/,
      /\bAND\s*$/,
      /\bOR\s*$/,
      /\bRETURN\s*$/,
      /\bMATCH\s*$/,
      /\bCREATE\s*$/
    ];

    for (const pattern of incompletePatterns) {
      if (pattern.test(upperQuery)) {
        errors.push('Query appears to be incomplete - ends with keyword requiring continuation');
      }
    }

    return errors;
  }

  /**
   * Sanitize query by removing dangerous elements and fixing common issues
   */
  static sanitizeQuery(query: string): string {
    if (!query) return '';
    
    let sanitized = query.trim();
    
    // Remove potential SQL injection patterns (basic protection)
    sanitized = sanitized.replace(/;\s*--/g, ';');  // Remove comment injections
    sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, '');  // Remove block comments
    
    // Fix common quote issues
    sanitized = sanitized.replace(/'/g, "'");  // Normalize quotes
    sanitized = sanitized.replace(/"/g, '"');  // Normalize quotes
    
    return sanitized;
  }

  /**
   * Log query validation results with appropriate log levels
   */
  static logValidationResult(query: string, result: QueryValidationResult, queryId?: string): void {
    const prefix = queryId ? `[Query ${queryId}]` : '[Query Validation]';
    
    if (!result.isValid) {
      console.error(`${prefix} Query validation failed:`, {
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        errors: result.errors,
        warnings: result.warnings
      });
    } else if (result.warnings.length > 0) {
      console.warn(`${prefix} Query validation warnings:`, {
        query: query.substring(0, 200) + (query.length > 200 ? '...' : ''),
        warnings: result.warnings
      });
    } else {
      console.debug(`${prefix} Query validation passed`);
    }
  }
}

/**
 * Enhanced error handling for Neo4j operations
 */
export class Neo4jErrorHandler {
  /**
   * Parse Neo4j error and provide helpful error messages
   */
  static parseError(error: any): {
    type: string;
    message: string;
    suggestions: string[];
    isRecoverable: boolean;
  } {
    const errorMessage = error.message || error.toString();
    
    // Lexical errors (like the original issue)
    if (errorMessage.includes('LexicalError') || errorMessage.includes('lexical error')) {
      const columnMatch = errorMessage.match(/column (\d+)/);
      const column = columnMatch ? columnMatch[1] : 'unknown';
      
      return {
        type: 'LEXICAL_ERROR',
        message: `Syntax error in query at column ${column}`,
        suggestions: [
          'Check for unmatched quotes, brackets, or parentheses',
          'Ensure all string literals are properly closed',
          'Verify query syntax is complete and not truncated',
          'Check for empty string literals or trailing commas'
        ],
        isRecoverable: true
      };
    }
    
    // Connection errors
    if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('Failed to connect')) {
      return {
        type: 'CONNECTION_ERROR',
        message: 'Cannot connect to Neo4j database',
        suggestions: [
          'Verify Neo4j service is running',
          'Check database connection credentials',
          'Ensure correct host and port configuration',
          'Verify network connectivity'
        ],
        isRecoverable: true
      };
    }
    
    // Authentication errors
    if (errorMessage.includes('authentication failed') || errorMessage.includes('unauthorized')) {
      return {
        type: 'AUTH_ERROR',
        message: 'Database authentication failed',
        suggestions: [
          'Verify username and password are correct',
          'Check if user account is active',
          'Ensure user has required permissions'
        ],
        isRecoverable: true
      };
    }
    
    // Constraint violations
    if (errorMessage.includes('ConstraintValidationFailed')) {
      return {
        type: 'CONSTRAINT_ERROR',
        message: 'Database constraint violation',
        suggestions: [
          'Check for duplicate values in unique constraints',
          'Verify all required properties are provided',
          'Review data integrity requirements'
        ],
        isRecoverable: true
      };
    }
    
    return {
      type: 'UNKNOWN_ERROR',
      message: errorMessage,
      suggestions: ['Review error details and query syntax', 'Check database logs for more information'],
      isRecoverable: false
    };
  }
}
