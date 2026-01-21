// @ts-nocheck
/**
 * PostgreSQL Adapter - Transaction Tests
 *
 * Comprehensive transaction management tests (~35 tests):
 * - Transaction lifecycle (begin, commit, rollback)
 * - Query execution within transactions
 * - Transaction isolation and error handling
 * - Edge cases (double commit, double rollback, etc.)
 *
 * STRICT TESTING POLICY:
 * - If a test fails, analyze if test expectation is wrong OR implementation is buggy
 * - Present analysis before making ANY changes
 * - DO NOT weaken tests without user approval
 */

import { PostgresAdapter, PostgresConfig } from "../src";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// =============================================================================
// Test Setup
// =============================================================================

const TEST_CONFIG: PostgresConfig = {
  host: process.env["POSTGRES_HOST"] ?? "localhost",
  port: Number(process.env["POSTGRES_PORT"]) || 5432,
  database: process.env["POSTGRES_DB"] ?? "forja_test",
  user: process.env["POSTGRES_USER"] ?? "postgres",
  password: process.env["POSTGRES_PASSWORD"] ?? "postgres",
  ssl: false,
  max: 10,
  min: 2,
};

let adapter: PostgresAdapter;

// =============================================================================
// Transaction Lifecycle Tests (~35 tests)
// =============================================================================

describe("PostgresAdapter - Transaction Lifecycle", () => {
  beforeAll(async () => {
    adapter = new PostgresAdapter(TEST_CONFIG);
    await adapter.connect();

    // Create test table
    await adapter.executeRawQuery(
      `CREATE TABLE IF NOT EXISTS test_txn (
        id SERIAL PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      [],
    );
  });

  afterAll(async () => {
    await adapter.executeRawQuery("DROP TABLE IF EXISTS test_txn", []);
    await adapter.disconnect();
  });

  beforeEach(async () => {
    // Clean table before each test
    await adapter.executeRawQuery("DELETE FROM test_txn", []);
  });

  it("should fail to begin transaction when not connected", async () => {
    const disconnectedAdapter = new PostgresAdapter(TEST_CONFIG);

    const result = await disconnectedAdapter.beginTransaction();

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error?.name).toBe("TransactionError");
    expect(result.error?.code).toBe("TRANSACTION_ERROR");
    expect(result.error?.message).toContain("Not connected to database");
  });

  it("should begin transaction successfully", async () => {
    const result = await adapter.beginTransaction();

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const txn = result.data!;
    expect(txn).toBeDefined();
    expect(txn.id).toBeDefined();
    expect(typeof txn.id).toBe("string");
    expect(txn.id.length).toBeGreaterThan(0);

    // Clean up
    await txn.rollback();
  });

  it("should generate unique transaction IDs", async () => {
    const result1 = await adapter.beginTransaction();
    const result2 = await adapter.beginTransaction();

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);

    const txn1 = result1.data!;
    const txn2 = result2.data!;

    expect(txn1.id).not.toBe(txn2.id);

    // Clean up
    await txn1.rollback();
    await txn2.rollback();
  });

  it("should have transaction ID format with prefix and random suffix", async () => {
    const result = await adapter.beginTransaction();
    const txn = result.data!;

    // Format: tx_{timestamp}_{random}
    expect(txn.id).toMatch(/^tx_\d+_[a-z0-9]+$/);

    await txn.rollback();
  });

  it("should execute query within transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const queryResult = await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    expect(queryResult.success).toBe(true);
    expect(queryResult.data?.metadata.affectedRows).toBe(1);

    await txn.rollback();
  });

  it("should execute raw query within transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const queryResult = await txn.rawQuery(
      "INSERT INTO test_txn (value) VALUES ($1)",
      ["test"],
    );

    expect(queryResult.success).toBe(true);
    expect(queryResult.data?.metadata.affectedRows).toBe(1);

    await txn.rollback();
  });

  it("should commit transaction successfully", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Insert within transaction
    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "committed" },
    });

    // Commit
    const commitResult = await txn.commit();

    expect(commitResult.success).toBe(true);
    expect(commitResult.data).toBeUndefined();

    // Verify data was committed
    const selectResult = await adapter.executeQuery<{ value: string }>({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(selectResult.data?.rows).toHaveLength(1);
    expect(selectResult.data?.rows[0]?.value).toBe("committed");
  });

  it("should rollback transaction successfully", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Insert within transaction
    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "rollback me" },
    });

    // Rollback
    const rollbackResult = await txn.rollback();

    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.data).toBeUndefined();

    // Verify data was NOT committed
    const selectResult = await adapter.executeQuery({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(selectResult.data?.rows).toHaveLength(0);
  });

  it("should fail to commit already committed transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // First commit
    await txn.commit();

    // Second commit should fail
    const secondCommit = await txn.commit();

    expect(secondCommit.success).toBe(false);
    expect(secondCommit.error).toBeDefined();
    expect(secondCommit.error?.name).toBe("TransactionError");
    expect(secondCommit.error?.message).toContain(
      "Transaction already committed",
    );
  });

  it("should fail to rollback already committed transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Commit
    await txn.commit();

    // Rollback after commit should fail
    const rollbackResult = await txn.rollback();

    expect(rollbackResult.success).toBe(false);
    expect(rollbackResult.error).toBeDefined();
    expect(rollbackResult.error?.message).toContain(
      "Transaction already committed",
    );
  });

  it("should fail to commit already rolled back transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Rollback
    await txn.rollback();

    // Commit after rollback should fail
    const commitResult = await txn.commit();

    expect(commitResult.success).toBe(false);
    expect(commitResult.error).toBeDefined();
    expect(commitResult.error?.message).toContain(
      "Transaction already rolled back",
    );
  });

  it("should fail to rollback already rolled back transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // First rollback
    await txn.rollback();

    // Second rollback should fail
    const secondRollback = await txn.rollback();

    expect(secondRollback.success).toBe(false);
    expect(secondRollback.error).toBeDefined();
    expect(secondRollback.error?.message).toContain(
      "Transaction already rolled back",
    );
  });

  it("should fail to query in completed transaction (committed)", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.commit();

    // Query after commit should fail
    const queryResult = await txn.query({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(queryResult.success).toBe(false);
    expect(queryResult.error).toBeDefined();
    expect(queryResult.error?.message).toContain("Transaction already completed");
  });

  it("should fail to query in completed transaction (rolled back)", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.rollback();

    // Query after rollback should fail
    const queryResult = await txn.query({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(queryResult.success).toBe(false);
    expect(queryResult.error).toBeDefined();
    expect(queryResult.error?.message).toContain("Transaction already completed");
  });

  it("should fail to raw query in completed transaction (committed)", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.commit();

    // Raw query after commit should fail
    const queryResult = await txn.rawQuery("SELECT 1", []);

    expect(queryResult.success).toBe(false);
    expect(queryResult.error?.message).toContain("Transaction already completed");
  });

  it("should fail to raw query in completed transaction (rolled back)", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.rollback();

    // Raw query after rollback should fail
    const queryResult = await txn.rawQuery("SELECT 1", []);

    expect(queryResult.success).toBe(false);
    expect(queryResult.error?.message).toContain("Transaction already completed");
  });

  it("should isolate transaction changes from main connection", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Insert within transaction
    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "isolated" },
    });

    // Query from main connection (should not see uncommitted data)
    const selectResult = await adapter.executeQuery({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    // Should be empty (transaction not committed yet)
    expect(selectResult.data?.rows).toHaveLength(0);

    // Commit transaction
    await txn.commit();

    // Now main connection should see the data
    const selectResult2 = await adapter.executeQuery<{ value: string }>({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(selectResult2.data?.rows).toHaveLength(1);
    expect(selectResult2.data?.rows[0]?.value).toBe("isolated");
  });

  it("should execute multiple queries in transaction", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Multiple inserts
    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "first" },
    });

    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "second" },
    });

    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "third" },
    });

    // Commit all
    await txn.commit();

    // Verify all inserted
    const selectResult = await adapter.executeQuery({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(selectResult.data?.rows).toHaveLength(3);
  });

  it("should rollback all changes on rollback", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Multiple inserts
    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "first" },
    });

    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "second" },
    });

    // Rollback all
    await txn.rollback();

    // Verify nothing committed
    const selectResult = await adapter.executeQuery({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(selectResult.data?.rows).toHaveLength(0);
  });

  it("should support concurrent transactions", async () => {
    const txn1Result = await adapter.beginTransaction();
    const txn2Result = await adapter.beginTransaction();

    const txn1 = txn1Result.data!;
    const txn2 = txn2Result.data!;

    // Insert in both transactions
    await txn1.query({
      type: "insert",
      table: "test_txn",
      data: { value: "txn1" },
    });

    await txn2.query({
      type: "insert",
      table: "test_txn",
      data: { value: "txn2" },
    });

    // Commit both
    await txn1.commit();
    await txn2.commit();

    // Verify both committed
    const selectResult = await adapter.executeQuery<{ value: string }>({
      type: "select",
      table: "test_txn",
      select: "*",
      orderBy: [{ field: "value", direction: "asc" }],
    });

    expect(selectResult.data?.rows).toHaveLength(2);
    expect(selectResult.data?.rows[0]?.value).toBe("txn1");
    expect(selectResult.data?.rows[1]?.value).toBe("txn2");
  });

  it("should handle transaction query with SELECT", async () => {
    // Insert data first
    await adapter.executeQuery({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const selectResult = await txn.query<{ value: string }>({
      type: "select",
      table: "test_txn",
      select: ["value"],
    });

    expect(selectResult.success).toBe(true);
    expect(selectResult.data?.rows).toHaveLength(1);
    expect(selectResult.data?.rows[0]?.value).toBe("test");

    await txn.commit();
  });

  it("should handle transaction query with UPDATE", async () => {
    // Insert data first
    await adapter.executeQuery({
      type: "insert",
      table: "test_txn",
      data: { value: "old" },
    });

    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const updateResult = await txn.query({
      type: "update",
      table: "test_txn",
      data: { value: "new" },
      where: { value: "old" },
    });

    expect(updateResult.success).toBe(true);
    expect(updateResult.data?.metadata.affectedRows).toBe(1);

    await txn.commit();

    // Verify update
    const selectResult = await adapter.executeQuery<{ value: string }>({
      type: "select",
      table: "test_txn",
      select: ["value"],
    });

    expect(selectResult.data?.rows[0]?.value).toBe("new");
  });

  it("should handle transaction query with DELETE", async () => {
    // Insert data first
    await adapter.executeQuery({
      type: "insert",
      table: "test_txn",
      data: { value: "delete me" },
    });

    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const deleteResult = await txn.query({
      type: "delete",
      table: "test_txn",
      where: { value: "delete me" },
    });

    expect(deleteResult.success).toBe(true);
    expect(deleteResult.data?.metadata.affectedRows).toBe(1);

    await txn.commit();

    // Verify deletion
    const selectResult = await adapter.executeQuery({
      type: "select",
      table: "test_txn",
      select: "*",
    });

    expect(selectResult.data?.rows).toHaveLength(0);
  });

  it("should provide metadata for transaction queries", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const insertResult = await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    expect(insertResult.success).toBe(true);
    expect(insertResult.data?.metadata).toBeDefined();
    expect(insertResult.data?.metadata.rowCount).toBe(1);
    expect(insertResult.data?.metadata.affectedRows).toBe(1);

    await txn.rollback();
  });

  it("should provide metadata for transaction raw queries", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const result = await txn.rawQuery(
      "INSERT INTO test_txn (value) VALUES ($1)",
      ["test"],
    );

    expect(result.success).toBe(true);
    expect(result.data?.metadata.affectedRows).toBe(1);

    await txn.rollback();
  });

  it("should handle transaction query errors gracefully", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Invalid query (nonexistent table)
    const queryResult = await txn.query({
      type: "select",
      table: "nonexistent_table",
      select: "*",
    });

    expect(queryResult.success).toBe(false);
    expect(queryResult.error).toBeDefined();
    expect(queryResult.error?.name).toBe("QueryError");

    // Transaction should still be usable
    const validQuery = await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    expect(validQuery.success).toBe(true);

    await txn.rollback();
  });

  it("should handle transaction raw query errors gracefully", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // Invalid SQL
    const queryResult = await txn.rawQuery("INVALID SQL", []);

    expect(queryResult.success).toBe(false);
    expect(queryResult.error).toBeDefined();

    // Transaction should still be usable
    const validQuery = await txn.rawQuery(
      "INSERT INTO test_txn (value) VALUES ($1)",
      ["test"],
    );

    expect(validQuery.success).toBe(true);

    await txn.rollback();
  });

  it("should include query in error for transaction query failures", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const query = {
      type: "select" as const,
      table: "nonexistent_table",
      select: "*" as const,
    };

    const result = await txn.query(query);

    expect(result.success).toBe(false);
    expect(result.error?.query).toEqual(query);

    await txn.rollback();
  });

  it("should include SQL in error for transaction raw query failures", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const sql = "INVALID SQL";
    const result = await txn.rawQuery(sql, []);

    expect(result.success).toBe(false);
    expect(result.error?.sql).toBe(sql);

    await txn.rollback();
  });

  it("should include error details in transaction failures", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.commit();

    // Try to commit again
    const result = await txn.commit();

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("TRANSACTION_ERROR");
  });

  it("should release connection after commit", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    await txn.commit();

    // Connection should be released back to pool
    // We verify by checking adapter is still connected
    expect(adapter.isConnected()).toBe(true);
  });

  it("should release connection after rollback", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    await txn.query({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    await txn.rollback();

    // Connection should be released back to pool
    expect(adapter.isConnected()).toBe(true);
  });

  it("should handle transaction with COUNT query", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "test_txn",
      data: { value: "test" },
    });

    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const countResult = await txn.query<{ count: number }>({
      type: "count",
      table: "test_txn",
    });

    expect(countResult.success).toBe(true);
    expect(countResult.data?.rows[0]?.count).toBe(1);

    await txn.commit();
  });

  it("should handle transaction with complex WHERE clause", async () => {
    await adapter.executeQuery({
      type: "insert",
      table: "test_txn",
      data: { value: "test1" },
    });

    await adapter.executeQuery({
      type: "insert",
      table: "test_txn",
      data: { value: "test2" },
    });

    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    const result = await txn.query<{ value: string }>({
      type: "select",
      table: "test_txn",
      select: ["value"],
      where: {
        $or: [{ value: "test1" }, { value: "test2" }],
      },
    });

    expect(result.success).toBe(true);
    expect(result.data?.rows).toHaveLength(2);

    await txn.commit();
  });

  // =============================================================================
  // STRICT POSTGRES TRANSACTION TESTS
  // =============================================================================

  it("should abort transaction and disallow further queries after an error (Postgres behavior)", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data!;

    // This query will fail (syntax error)
    await txn.rawQuery("SELECT INVALID SQL", []);

    // After an error in Postgres, any subsequent query (except ROLLBACK or ROLLBACK TO SAVEPOINT) should fail
    const subsequentQuery = await txn.rawQuery("SELECT 1", []);

    expect(subsequentQuery.success).toBe(false);
    expect(subsequentQuery.error?.message).toMatch(
      /current transaction is aborted, commands ignored until end of transaction block/i,
    );

    await txn.rollback();
  });

  it("should support savepoints for partial rollbacks within a transaction", async () => {
    // Note: This test will fail if savepoints are not implemented in the adapter
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data! as any; // Cast to any to test potentially unimplemented methods

    if (typeof txn.savepoint !== "function") {
      await txn.rollback();
      throw new Error("Transaction interface does not support savepoints");
    }

    await txn.rawQuery("INSERT INTO test_txn (value) VALUES ($1)", ["before_sp"]);

    const spResult = await txn.savepoint("sp1");
    expect(spResult.success).toBe(true);

    await txn.rawQuery("INSERT INTO test_txn (value) VALUES ($1)", ["after_sp"]);

    // Rollback to savepoint
    const rbSpResult = await txn.rollbackTo("sp1");
    expect(rbSpResult.success).toBe(true);

    await txn.commit();

    // Verify only 'before_sp' exists
    const selectResult = await adapter.executeRawQuery<{ value: string }>(
      "SELECT value FROM test_txn",
      [],
    );
    expect(selectResult.data?.rows).toHaveLength(1);
    expect(selectResult.data?.rows[0]?.value).toBe("before_sp");
  });

  it("should recover from an error within a transaction using savepoints", async () => {
    const txnResult = await adapter.beginTransaction();
    const txn = txnResult.data! as any;

    if (typeof txn.savepoint !== "function") {
      await txn.rollback();
      throw new Error("Transaction interface does not support savepoints");
    }

    const spResult = await txn.savepoint("sp_error");
    expect(spResult.success).toBe(true);

    // This will fail
    await txn.rawQuery("SELECT INVALID SQL", []);

    // Recovery by rolling back to savepoint
    const rbSpResult = await txn.rollbackTo("sp_error");
    expect(rbSpResult.success).toBe(true);

    // Transaction should be usable again
    const subsequentQuery = await txn.rawQuery("SELECT 1 as val", []);
    expect(subsequentQuery.success).toBe(true);
    expect((subsequentQuery.data?.rows[0] as any).val).toBe(1);

    await txn.commit();
  });
});
