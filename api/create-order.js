const Razorpay = require("razorpay");
const admin = require("firebase-admin");

function firebase() {
  if (!admin.apps.length) admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
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
    const h = req.headers.authorization || "";

    if (!h.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Login required." });
    }

    const a = firebase();
    const user = await a.auth().verifyIdToken(h.slice(7));

    const amount = Number(req.body?.amount);

    if (!Number.isFinite(amount) || amount < 10 || amount > 1000) {
      return res.status(400).json({
        error: "Amount must be between ₹10 and ₹1000."
      });
    }

    const r = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await r.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: `jh_${user.uid.slice(0, 10)}_${Date.now()}`,
      notes: {
        uid: user.uid,
        purpose: "wallet_recharge"
      }
    });

    return res.status(200).json({
      id: order.id,
      amount: order.amount,
      currency: order.currency
    });

  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: e.message || "Could not create order."
    });
  }
};
