import { describe, expect, it } from "vitest";

import { findDatabaseSchemaErrorCode } from "../src/database-schema-exception.filter.js";

describe("database schema exception detection", () => {
  it("detects a missing table nested in a Drizzle query error", () => {
    const error = new Error("Failed query", {
      cause: Object.assign(new Error("Table does not exist"), { code: "ER_NO_SUCH_TABLE" }),
    });

    expect(findDatabaseSchemaErrorCode(error)).toBe("ER_NO_SUCH_TABLE");
  });

  it("detects a missing column and ignores unrelated database failures", () => {
    expect(findDatabaseSchemaErrorCode({
      cause: { code: "ER_BAD_FIELD_ERROR" },
    })).toBe("ER_BAD_FIELD_ERROR");
    expect(findDatabaseSchemaErrorCode({
      cause: { code: "ER_ACCESS_DENIED_ERROR" },
    })).toBeNull();
  });
});
