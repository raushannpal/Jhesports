export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const webhookData = req.body || {};

    console.log("ZapUPI Webhook:", webhookData);

    // Payment verification aur Firebase wallet credit
    // next step me add karenge.

    return res.status(200).json({
      success: true,
      message: "Webhook received"
    });

  } catch (error) {
    console.error("ZapUPI Webhook Error:", error);

    return res.status(500).json({
      success: false,
      message: "Webhook processing failed"
    });
  }
}
