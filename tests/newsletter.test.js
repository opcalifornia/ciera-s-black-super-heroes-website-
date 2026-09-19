process.env.DB_PATH = ":memory:";
process.env.ADMIN_PASSWORD = "test-admin-password";

import { describe, it, expect } from "vitest";
const request = require("supertest");
const app = require("../server");

describe("POST /api/newsletter", () => {
  it("accepts a valid email and confirms sign-up", async () => {
    const res = await request(app).post("/api/newsletter").send({ email: "reader@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("is idempotent for the same email", async () => {
    await request(app).post("/api/newsletter").send({ email: "dup@example.com" });
    const res = await request(app).post("/api/newsletter").send({ email: "dup@example.com" });
    expect(res.status).toBe(200);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app).post("/api/newsletter").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid email/i);
  });

  it("rejects a missing email", async () => {
    const res = await request(app).post("/api/newsletter").send({});
    expect(res.status).toBe(400);
  });
});
