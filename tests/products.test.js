process.env.DB_PATH = ":memory:";
process.env.ADMIN_PASSWORD = "test-admin-password";

import { describe, it, expect } from "vitest";
const request = require("supertest");
const app = require("../server");

describe("products API", () => {
  it("GET /api/products lists the seeded, active products sorted by display order", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((p) => p.slug)).toEqual(["edition-one", "edition-two", "bundle"]);
    expect(res.body[0]).toHaveProperty("images");
  });

  it("GET /api/products/:slug returns a single product", async () => {
    const res = await request(app).get("/api/products/edition-one");
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe("edition-one");
  });

  it("GET /api/products/:slug 404s for an unknown slug", async () => {
    const res = await request(app).get("/api/products/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });

  it("GET /api/search finds products by title/description", async () => {
    const res = await request(app).get("/api/search").query({ q: "bundle" });
    expect(res.status).toBe(200);
    expect(res.body.some((p) => p.slug === "bundle")).toBe(true);
  });

  it("GET /api/search with no query returns an empty array", async () => {
    const res = await request(app).get("/api/search");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("GET /api/site returns site settings", async () => {
    const res = await request(app).get("/api/site");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("storeName");
  });
});
