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
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({
        error: "Missing webhook signature."
      });
    }

    const rawBody =
      typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    const expectedSignature = crypto
      .createHmac(
        "sha256",
        process.env.RAZORPAY_WEBHOOK_SECRET
      )
      .update(rawBody)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(400).json({
        error: "Invalid webhook signature."
      });
    }

    const event =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body;

    if (event.event !== "payment.captured") {
      return res.status(200).json({
        received: true,
        ignored: true
      });
    }

    const payment = event.payload?.payment?.entity;

    if (!payment) {
      return res.status(400).json({
        error: "Payment data missing."
      });
    }

    const orderId = payment.order_id;
    const paymentId = payment.id;

    if (!orderId || !paymentId) {
      return res.status(400).json({
        error: "Order/payment ID missing."
      });
    }

    const firebaseAdmin = firebase();
    const db = firebaseAdmin.database();

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.fetch(orderId);

    const uid = order.notes?.uid;

    if (
      !uid ||
      order.notes?.purpose !== "wallet_recharge"
    ) {
      return res.status(400).json({
        error: "Invalid wallet recharge order."
      });
    }

    const amount = Number(order.amount) / 100;

    const creditRef = db.ref(
      `paymentCredits/${paymentId}`
    );

    const existing = await creditRef.once("value");

    if (existing.exists()) {
      return res.status(200).json({
        received: true,
        alreadyCredited: true
      });
    }

    const balanceRef = db.ref(
      `users/${uid}/balance`
    );

    await balanceRef.transaction((currentBalance) => {
      const current = Number(currentBalance || 0);
      return current + amount;
    });

    const transactionRef = db
      .ref(`transactions/${uid}`)
      .push();

    await transactionRef.set({
      type: "credit",
      amount: amount,
      method: "Razorpay",
      paymentId: paymentId,
      orderId: orderId,
      status: "success",
      createdAt: Date.now()
    });

    await creditRef.set({
      uid: uid,
      amount: amount,
      orderId: orderId,
      paymentId: paymentId,
      status: "credited",
      source: "webhook",
      createdAt: Date.now()
    });

    return res.status(200).json({
      received: true,
      credited: true
    });

  } catch (error) {
    console.error("RAZORPAY WEBHOOK ERROR:", error);

    return res.status(500).json({
      error: "Webhook processing failed."
    });
  }
};
