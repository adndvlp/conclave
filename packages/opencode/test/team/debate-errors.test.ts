import { describe, expect, test } from "bun:test"
import { errorDescription } from "../../src/team/debate"

describe("errorDescription", () => {
  test("rate limit 429", () => {
    expect(errorDescription(new Error("Too Many Requests"))).toBe("rate_limited")
    expect(errorDescription(new Error("Rate limit exceeded"))).toBe("rate_limited")
  })

  test("server error", () => {
    expect(errorDescription(new Error("503 Service Unavailable"))).toBe("server_error")
    expect(errorDescription(new Error("502 Bad Gateway"))).toBe("server_error")
    expect(errorDescription(new Error("server error"))).toBe("server_error")
  })

  test("context limit", () => {
    expect(errorDescription(new Error("context window exceeded"))).toBe("context_limit")
    expect(errorDescription(new Error("token limit reached"))).toBe("context_limit")
    expect(errorDescription(new Error("input is too long"))).toBe("context_limit")
  })

  test("quota exceeded", () => {
    expect(errorDescription(new Error("insufficient quota"))).toBe("quota_exceeded")
    expect(errorDescription(new Error("billing error"))).toBe("quota_exceeded")
  })

  test("auth error", () => {
    expect(errorDescription(new Error("401 Unauthorized"))).toBe("auth_error")
    expect(errorDescription(new Error("403 Forbidden"))).toBe("auth_error")
    expect(errorDescription(new Error("auth error"))).toBe("auth_error")
  })

  test("timeout via AbortError", () => {
    expect(errorDescription(new DOMException("timeout", "AbortError"))).toBe("timeout")
  })

  test("fallback trimmed message", () => {
    const long = new Error("x".repeat(200))
    expect(errorDescription(long).length).toBe(80)
    expect(errorDescription(long)).toBe("x".repeat(80))
  })

  test("non-Error values", () => {
    expect(errorDescription("plain string")).toBe("plain string")
    expect(errorDescription(42)).toBe("42")
    expect(errorDescription({})).toBe("[object Object]")
  })
})
