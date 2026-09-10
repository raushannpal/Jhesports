const Razorpay = require("razorpay");
const crypto = require("crypto");
const admin = require("firebase-admin");

function firebase() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }
  return admin;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Login required." });
    }

    const firebaseAdmin = firebase();
    const decoded = await firebaseAdmin
      .auth()
      .verifyIdToken(authHeader.slice(7));

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
        error: "Payment details are missing."
      });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (
      !crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
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

    const payment = await razorpay.payments.fetch(razorpay_payment_id);
    const order = await razorpay.orders.fetch(razorpay_order_id);

    if (payment.status !== "captured") {
      return res.status(400).json({
        error: "Payment has not been captured."
      });
    }

    if (Number(payment.amount) !== Number(order.amount)) {
      return res.status(400).json({
        error: "Payment amount mismatch."
      });
    }

    if (
      !order.notes ||
      order.notes.uid !== decoded.uid ||
      order.notes.purpose !== "wallet_recharge"
    ) {
      return res.status(403).json({
        error: "Payment does not belong to this account."
      });
    }

    const db = firebaseAdmin.database();

    const creditRef = db.ref(
      `paymentCredits/${razorpay_payment_id}`
    );

    const existing = await creditRef.once("value");

    if (existing.exists()) {
      return res.status(200).json({
        success: true,
        alreadyCredited: true,
        message: "Payment already credited."
      });
    }

    const amountRupees = Number(order.amount) / 100;

    const balanceRef = db.ref(`users/${decoded.uid}/balance`);

    await balanceRef.transaction((currentBalance) => {
      const current = Number(currentBalance || 0);
      return current + amountRupees;
    });

    const transactionRef = db.ref(`transactions/${decoded.uid}`).push();

    await transactionRef.set({
      type: "credit",
      amount: amountRupees,
      method: "Razorpay",
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      status: "success",
      createdAt: Date.now()
    });

    await creditRef.set({
      uid: decoded.uid,
      amount: amountRupees,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      status: "credited",
      createdAt: Date.now()
    });

    return res.status(200).json({
      success: true,
      credited: true,
      amount: amountRupees,
      message: `₹${amountRupees} added to wallet successfully.`
    });

  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);

    return res.status(500).json({
      error: error.message || "Payment verification failed."
    });
  }
};
