process.env.DB_PATH = ":memory:";
process.env.ADMIN_PASSWORD = "correct-horse-battery";

import { describe, it, expect } from "vitest";
const request = require("supertest");
const app = require("../server");

describe("admin auth", () => {
  it("rejects admin routes with no session", async () => {
    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await request(app).post("/api/admin/login").send({ password: "nope" });
    expect(res.status).toBe(401);
  });

  it("logs in, reads with the session cookie, and requires CSRF on writes", async () => {
    const agent = request.agent(app);
    const login = await agent.post("/api/admin/login").send({ password: "correct-horse-battery" });
    expect(login.status).toBe(200);
    const csrfToken = login.body.csrfToken;
    expect(csrfToken).toBeTruthy();

    const summary = await agent.get("/api/admin/summary");
    expect(summary.status).toBe(200);
    expect(summary.body).toHaveProperty("products");

    const writeWithoutCsrf = await agent.put("/api/admin/site").send({ storeName: "Attempted" });
    expect(writeWithoutCsrf.status).toBe(403);

    const writeWithCsrf = await agent.put("/api/admin/site").set("X-CSRF-Token", csrfToken).send({ storeName: "New Name" });
    expect(writeWithCsrf.status).toBe(200);
    expect(writeWithCsrf.body.storeName).toBe("New Name");
  });

  it("recovers a CSRF token from GET /api/admin/session", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/login").send({ password: "correct-horse-battery" });
    const session = await agent.get("/api/admin/session");
    expect(session.status).toBe(200);
    expect(session.body.csrfToken).toBeTruthy();
  });

  it("invalidates the session on logout", async () => {
    const agent = request.agent(app);
    await agent.post("/api/admin/login").send({ password: "correct-horse-battery" });
    await agent.post("/api/admin/logout");
    const res = await agent.get("/api/admin/summary");
    expect(res.status).toBe(401);
  });

  it("rate-limits repeated bad login attempts", async () => {
    const agent = request.agent(app);
    let lastStatus;
    for (let i = 0; i < 10; i++) {
      lastStatus = (await agent.post("/api/admin/login").send({ password: "wrong" })).status;
    }
    expect(lastStatus).toBe(429);
  });
});
