# Memento MCP API Tests

This directory contains comprehensive test suites for the Memento MCP REST API, implementing all test cases defined in `docs/API_TEST_CASES.md`.

## Test Structure

### Test Files

- **`api.test.ts`** - Main integration test suite covering all API endpoints
- **`api-performance.test.ts`** - Performance and load testing suite

### Test Categories

#### Integration Tests (`api.test.ts`)
- **Health and Info Endpoints** - Basic server health and API information
- **Authentication** - API key validation and security
- **Entity Management** - CRUD operations for entities
- **Relation Management** - CRUD operations for relations
- **Search Functionality** - Text search with filters and pagination
- **Analytics Endpoints** - Graph statistics and system health
- **Temporal Queries** - Historical data access
- **Expertise Areas** - Domain-specific functionality
- **Error Handling** - Validation and error response testing
- **Integration Tests** - End-to-end workflows

#### Performance Tests (`api-performance.test.ts`)
- **Entity Creation Performance** - Bulk entity creation timing
- **Search Performance** - Large dataset search optimization
- **Concurrent Request Handling** - Multi-user simulation
- **Memory Usage** - Resource consumption monitoring
- **Response Time Consistency** - Performance stability testing

## Running Tests

### Prerequisites

1. **Node.js 18+** - Required for modern JavaScript features
2. **Dependencies** - Install with `npm install`
3. **Test Environment** - Tests use temporary file storage

### Test Commands

```bash
# Run all API tests
npm run test:api

# Run only integration tests
npm run test:api:integration

# Run only performance tests
npm run test:api:performance

# Watch mode for development
npm run test:api:watch

# Run with coverage
npm run test:coverage -- src/api/__vitest__/**/*.test.ts
```

### Manual Test Runner

Use the custom test runner for detailed output:

```bash
# Run all tests with detailed reporting
node scripts/testing/run-api-tests.js all

# Run specific test suite
node scripts/testing/run-api-tests.js integration
node scripts/testing/run-api-tests.js performance
```

## Test Configuration

### Environment Variables

Tests automatically set up their environment:

```bash
NODE_ENV=test
API_PORT=3000
API_HOST=localhost
```

### Test Data

- **Temporary Storage** - Each test run uses isolated temporary directories
- **Auto Cleanup** - Test data is automatically cleaned up after each test
- **Consistent Data** - Predefined test entities and relations for reproducible results

### API Configuration

Tests create API servers with:
- **Authentication** - API key validation enabled
- **CORS** - Cross-origin requests allowed
- **File Storage** - Temporary file-based storage provider
- **Error Handling** - Comprehensive error middleware

## Test Data Patterns

### Standard Test Entities

```javascript
const testEntities = [
  {
    name: 'TestUser_001',
    entityType: 'person',
    observations: ['Software developer', 'Works on AI projects', 'Based in Melbourne']
  },
  {
    name: 'TestProject_001',
    entityType: 'project',
    observations: ['Knowledge graph system', 'TypeScript implementation', 'MCP protocol']
  }
];
```

### Standard Test Relations

```javascript
const testRelations = [
  {
    from: 'TestUser_001',
    to: 'TestProject_001',
    relationType: 'works_on'
  }
];
```

## Performance Benchmarks

### Expected Performance Metrics

- **Entity Creation** - 100 entities in < 5 seconds
- **Search Response** - Large dataset search in < 2 seconds
- **Concurrent Requests** - 20 concurrent requests in < 5 seconds
- **Memory Usage** - < 50MB increase for large operations
- **Response Consistency** - < 800ms variance in response times

### Load Testing

Performance tests simulate:
- **Bulk Operations** - Large batch entity creation
- **High Concurrency** - Multiple simultaneous requests
- **Sustained Load** - Continuous requests over time
- **Mixed Workloads** - Combination of read/write operations

## Error Testing

### Validation Testing

- **Invalid JSON** - Malformed request payloads
- **Missing Fields** - Required parameter validation
- **Type Validation** - Incorrect data types
- **Business Logic** - Domain-specific validation rules

### HTTP Error Codes

Tests verify proper HTTP status codes:
- **200 OK** - Successful operations
- **201 Created** - Resource creation
- **204 No Content** - Successful deletion
- **400 Bad Request** - Validation errors
- **401 Unauthorized** - Authentication failures
- **404 Not Found** - Missing resources
- **405 Method Not Allowed** - Unsupported HTTP methods
- **501 Not Implemented** - Optional features

## Integration Workflows

### Complete Entity Lifecycle

1. **Create** entity via POST
2. **Retrieve** entity via GET
3. **Update** entity via PUT
4. **Add observations** via POST
5. **Search** for entity
6. **Delete** entity via DELETE
7. **Verify deletion** via GET (404)

### Entity-Relation Integration

1. **Create entities** for relation endpoints
2. **Create relations** between entities
3. **Verify relations** exist
4. **Test cascade deletion** behavior
5. **Verify relation cleanup**

## Debugging Tests

### Common Issues

1. **Port Conflicts** - Tests use dynamic ports to avoid conflicts
2. **File Permissions** - Temporary directories created with proper permissions
3. **Async Operations** - All operations properly awaited
4. **Memory Leaks** - Resources cleaned up in afterEach/afterAll hooks

### Debug Output

Enable verbose logging:

```bash
DEBUG=* npm run test:api
```

### Test Isolation

Each test:
- **Starts fresh** - Clean temporary directory
- **Isolated data** - No shared state between tests
- **Proper cleanup** - Resources released after completion

## Extending Tests

### Adding New Test Cases

1. **Follow patterns** - Use existing test structure
2. **Proper setup/teardown** - Initialize and clean up resources
3. **Descriptive names** - Clear test descriptions
4. **Assertions** - Comprehensive validation
5. **Error cases** - Test both success and failure scenarios

### Performance Test Guidelines

1. **Realistic data** - Use representative test data sizes
2. **Timing accuracy** - Measure actual operation time
3. **Resource monitoring** - Track memory and CPU usage
4. **Baseline comparison** - Compare against expected benchmarks
5. **Concurrent testing** - Simulate real-world load patterns

## Continuous Integration

### CI/CD Integration

Tests are designed for automated environments:
- **No external dependencies** - Self-contained test environment
- **Deterministic results** - Consistent behavior across runs
- **Proper exit codes** - Success/failure indication
- **Detailed reporting** - Comprehensive test output

### GitHub Actions Example

```yaml
name: API Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:api
```

## Troubleshooting

### Common Solutions

1. **Dependencies** - Run `npm install` to ensure all packages are installed
2. **Node Version** - Ensure Node.js 18+ is installed
3. **Permissions** - Check file system permissions for temporary directories
4. **Port Usage** - Ensure no other services are using test ports
5. **Memory** - Increase Node.js memory limit if needed: `--max-old-space-size=4096`

### Getting Help

- **Documentation** - Refer to `docs/API_TEST_CASES.md` for detailed specifications
- **Issues** - Report problems via GitHub issues
- **Logs** - Check test output for detailed error information
- **Debug Mode** - Use `DEBUG=*` for verbose logging

## Contributing

When contributing to API tests:

1. **Follow conventions** - Match existing code style
2. **Add documentation** - Update README for new features
3. **Test coverage** - Ensure comprehensive test coverage
4. **Performance impact** - Consider performance implications
5. **Backward compatibility** - Maintain existing test compatibility
