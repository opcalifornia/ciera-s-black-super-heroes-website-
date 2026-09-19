process.env.DB_PATH = ":memory:";
process.env.ADMIN_PASSWORD = "test-admin-password";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

import { describe, it, expect, beforeAll } from "vitest";
const request = require("supertest");
const app = require("../server");
const store = require("../db");
const { _setStripeForTests } = require("../lib/stripe");

let order;

beforeAll(() => {
  store.updateProduct("p1", { price: 2999, inventory: 5 });
  order = store.createOrder({
    customer: { name: "Jamie", email: "jamie@example.com", address: "", note: "" },
    lines: [{ productId: "p1", title: "Edition one", unitPrice: 2999, qty: 2 }],
    subtotal: 5998,
    shipping: 0,
    total: 5998,
  });
  store.setOrderStripeSession(order.id, "cs_test_webhook_1");

  // A fake Stripe client: constructEvent just parses the raw body instead of
  // verifying a real signature, which is what "a mocked Stripe signature"
  // means for a webhook test — the interesting behavior under test is what
  // our handler does with the event, not Stripe's own crypto.
  _setStripeForTests({
    webhooks: {
      constructEvent(payload, signature) {
        if (signature !== "valid-test-signature") throw new Error("signature mismatch");
        return JSON.parse(payload.toString());
      },
    },
  });
});

function checkoutCompletedEvent(overrides = {}) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_webhook_1",
        payment_intent: "pi_test_1",
        metadata: { orderId: order.id, orderNumber: String(order.number) },
        shipping_details: {
          address: { line1: "1 Main St", city: "Springfield", state: "IL", postal_code: "62704", country: "US" },
        },
        ...overrides,
      },
    },
  };
}

describe("POST /api/stripe/webhook", () => {
  it("rejects a request with a bad signature", async () => {
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "wrong-signature")
      .send(JSON.stringify(checkoutCompletedEvent()));
    expect(res.status).toBe(400);
  });

  it("marks the order paid, saves the shipping address, and decrements inventory", async () => {
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "valid-test-signature")
      .send(JSON.stringify(checkoutCompletedEvent()));
    expect(res.status).toBe(200);

    const paid = store.getOrderById(order.id);
    expect(paid.status).toBe("paid");
    expect(paid.stripePaymentIntentId).toBe("pi_test_1");
    expect(paid.customer.address).toMatch(/1 Main St/);

    const product = store.getProductById("p1");
    expect(product.inventory).toBe(3); // 5 - 2
  });

  it("is idempotent: a repeated event doesn't double-decrement inventory", async () => {
    await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "valid-test-signature")
      .send(JSON.stringify(checkoutCompletedEvent()));

    const product = store.getProductById("p1");
    expect(product.inventory).toBe(3);
  });
});
