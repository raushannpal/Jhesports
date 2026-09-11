const Razorpay = require("razorpay");
const getFirebase = require("./_firebase");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const authHeader = req.headers.authorization || "";

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Login required."
      });
    }

    const admin = getFirebase();

    const decoded = await admin.auth().verifyIdToken(
      authHeader.slice(7)
    );

    const amount = Number(req.body?.amount);

    if (
      !Number.isFinite(amount) ||
      amount < 10 ||
      amount > 1000
    ) {
      return res.status(400).json({
        error: "Amount must be between ₹10 and ₹1000."
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `jh_${decoded.uid.slice(0, 10)}_${Date.now()}`,
      notes: {
        uid: decoded.uid,
        purpose: "wallet_recharge"
      }
    });

    return res.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency
    });

  } catch (error) {
    console.error("CREATE ORDER ERROR:", error);

    return res.status(500).json({
      error: "Could not create payment order."
    });
  }
};
