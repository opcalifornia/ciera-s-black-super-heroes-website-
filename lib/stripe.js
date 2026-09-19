// Thin wrapper around the Stripe SDK so the rest of the app doesn't need to
// know whether a real secret key is configured yet.
let _stripe = null;

function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set. Add it to your environment (see .env.example) before accepting payments.");
  }
  const Stripe = require("stripe");
  _stripe = new Stripe(key);
  return _stripe;
}

// Test-only hook: lets the test suite inject a fake Stripe client instead of
// hitting the network or requiring a real API key.
function _setStripeForTests(client) {
  _stripe = client;
}

module.exports = { getStripe, _setStripeForTests };
