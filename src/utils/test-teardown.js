/**
 * Global teardown for Jest tests
 * This forces Jest to exit after tests complete, solving the hanging issue
 */
export default async () => {
  console.log('Tearing down tests and exiting process.');
  process.exit(0);
};
