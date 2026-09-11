const crypto = require("crypto");
const Razorpay = require("razorpay");
const getFirebase = require("./_firebase");
const creditPayment = require("./_credit-payment");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Login required." });
    }

    const admin = getFirebase();

    const decoded = await admin.auth().verifyIdToken(
      authHeader.slice(7)
    );

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body || {};

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: "Missing payment details."
      });
    }

    const generatedSignature = crypto
      .createHmac(
        "sha256",
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(
        razorpay_order_id + "|" + razorpay_payment_id
      )
      .digest("hex");

    if (
      generatedSignature.length !== razorpay_signature.length ||
      !crypto.timingSafeEqual(
        Buffer.from(generatedSignature),
        Buffer.from(razorpay_signature)
      )
    ) {
      return res.status(400).json({
        error: "Invalid payment signature."
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const payment = await razorpay.payments.fetch(
      razorpay_payment_id
    );

    const order = await razorpay.orders.fetch(
      razorpay_order_id
    );

    if (payment.status !== "captured") {
      return res.status(400).json({
        error: "Payment is not captured."
      });
    }

    if (payment.order_id !== order.id) {
      return res.status(400).json({
        error: "Payment/order mismatch."
      });
    }

    if (order.notes?.uid !== decoded.uid) {
      return res.status(403).json({
        error: "Payment user mismatch."
      });
    }

    if (order.notes?.purpose !== "wallet_recharge") {
      return res.status(400).json({
        error: "Invalid payment purpose."
      });
    }

    if (Number(payment.amount) !== Number(order.amount)) {
      return res.status(400).json({
        error: "Payment amount mismatch."
      });
    }

    const result = await creditPayment({
      uid: decoded.uid,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      amount: Number(order.amount) / 100
    });

    return res.status(200).json({
      success: true,
      credited: !result.alreadyCredited,
      alreadyCredited: result.alreadyCredited,
      amount: result.amount,
      balance: result.balance
    });

  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);

    return res.status(500).json({
      error: "Payment verification failed."
    });
  }
};
