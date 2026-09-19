process.env.DB_PATH = ":memory:";
process.env.ADMIN_PASSWORD = "test-admin-password";

import { describe, it, expect } from "vitest";
const request = require("supertest");
const app = require("../server");
const store = require("../db");

describe("POST /api/contact", () => {
  it("saves a valid message", async () => {
    const res = await request(app)
      .post("/api/contact")
      .send({ name: "Jamie", email: "jamie@example.com", message: "How do I order a bulk case?" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(store.listMessages().some((m) => m.email === "jamie@example.com")).toBe(true);
  });

  it("rejects a missing name", async () => {
    const res = await request(app).post("/api/contact").send({ email: "a@b.com", message: "hi" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid email", async () => {
    const res = await request(app).post("/api/contact").send({ name: "A", email: "nope", message: "hi" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty message", async () => {
    const res = await request(app).post("/api/contact").send({ name: "A", email: "a@b.com", message: "" });
    expect(res.status).toBe(400);
  });
});
