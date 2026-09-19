process.env.DB_PATH = ":memory:";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.PUBLIC_URL = "http://localhost:3000";

import { describe, it, expect, beforeAll, vi } from "vitest";
const request = require("supertest");
const app = require("../server");
const store = require("../db");
const { _setStripeForTests } = require("../lib/stripe");

const fakeSession = { id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" };
const createSession = vi.fn().mockResolvedValue(fakeSession);

beforeAll(() => {
  store.updateProduct("p1", { price: 2999 });
  _setStripeForTests({ checkout: { sessions: { create: createSession } } });
});

describe("POST /api/orders", () => {
  it("rejects an empty cart", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [], customer: { name: "A", email: "a@b.com" } });
    expect(res.status).toBe(400);
  });

  it("rejects a missing customer email", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ id: "p1", qty: 1 }], customer: { name: "A" } });
    expect(res.status).toBe(400);
  });

  it("rejects an item that isn't a real product", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ id: "does-not-exist", qty: 1 }], customer: { name: "A", email: "a@b.com" } });
    expect(res.status).toBe(400);
  });

  it("rejects a product with no price set", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ id: "p2", qty: 1 }], customer: { name: "A", email: "a@b.com" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/i);
  });

  it("creates a pending order and returns the Stripe Checkout URL", async () => {
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ id: "p1", qty: 2 }], customer: { name: "Jamie", email: "jamie@example.com" } });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(fakeSession.url);
    expect(res.body.orderNumber).toBeGreaterThan(1000);
    expect(createSession).toHaveBeenCalled();

    const [args] = createSession.mock.calls.at(-1);
    expect(args.line_items[0].quantity).toBe(2);
    expect(args.line_items[0].price_data.unit_amount).toBe(2999);
    expect(args.customer_email).toBe("jamie@example.com");

    // Inventory is untouched until the webhook confirms payment.
    const order = store.getOrderByStripeSession(fakeSession.id);
    expect(order.status).toBe("pending_payment");
  });

  it("returns a 502 (not a crash) when Stripe itself fails", async () => {
    createSession.mockRejectedValueOnce(new Error("network down"));
    const res = await request(app)
      .post("/api/orders")
      .send({ items: [{ id: "p1", qty: 1 }], customer: { name: "A", email: "a@b.com" } });
    expect(res.status).toBe(502);
  });
});
