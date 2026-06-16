import { describe, expect, it } from "vitest";
import { WELCOME_BONUS } from "@shared/types";
import { getOrCreateUserCredits } from "../lib/credits";
import type { Env } from "../types";

function createMockEnv(): Env {
  const credits = new Map<string, Record<string, unknown>>();
  const transactions: Record<string, unknown>[] = [];

  return {
    DB: {
      prepare(sql: string) {
        return {
          _bindings: [] as unknown[],
          bind(...args: unknown[]) {
            this._bindings = args;
            return this;
          },
          async first<T>() {
            if (sql.includes('FROM "user_credits"')) {
              return (credits.get(this._bindings[0] as string) || null) as T | null;
            }
            return null;
          },
          async run() {
            if (sql.includes('INSERT OR IGNORE INTO "user_credits"')) {
              const [id, userId, balance, freeBalance, purchasedBalance] = this._bindings;
              if (credits.has(userId as string)) {
                return { meta: { changes: 0 } };
              }

              credits.set(userId as string, {
                id,
                userId,
                balance,
                free_balance: freeBalance,
                purchased_balance: purchasedBalance,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
              return { meta: { changes: 1 } };
            }

            if (sql.includes('INSERT INTO "credit_transaction"')) {
              transactions.push({
                id: this._bindings[0],
                userId: this._bindings[1],
                amount: this._bindings[2],
                description: this._bindings[3],
              });
              return { meta: { changes: 1 } };
            }

            return { meta: { changes: 0 } };
          },
        };
      },
    } as unknown as D1Database,
    _testTransactions: transactions,
  } as unknown as Env & { _testTransactions: Record<string, unknown>[] };
}

describe("credits", () => {
  it("creates first-login credits with the welcome bonus", async () => {
    const env = createMockEnv() as Env & { _testTransactions: Record<string, unknown>[] };

    const credits = await getOrCreateUserCredits(env, "user-1");

    expect(credits.balance).toBe(WELCOME_BONUS);
    expect(credits.free_balance).toBe(WELCOME_BONUS);
    expect(credits.purchased_balance).toBe(0);
    expect(env._testTransactions).toHaveLength(1);
    expect(env._testTransactions[0].amount).toBe(10000);
  });

  it("does not duplicate welcome bonus transactions", async () => {
    const env = createMockEnv() as Env & { _testTransactions: Record<string, unknown>[] };

    await getOrCreateUserCredits(env, "user-1");
    await getOrCreateUserCredits(env, "user-1");

    expect(env._testTransactions).toHaveLength(1);
  });
});
