export default async function handler(req, res) {
  // Only POST requests allowed
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const {
      order_id,
      amount,
      customer_mobile,
      remark
    } = req.body || {};

    // -----------------------------
    // Basic validation
    // -----------------------------
    if (!order_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "order_id and amount are required"
      });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount"
      });
    }

    // -----------------------------
    // ZapUPI key must stay on server
    // -----------------------------
    const zapKey = process.env.ZAPUPI_KEY;

    if (!zapKey) {
      console.error("ZAPUPI_KEY is missing");

      return res.status(500).json({
        success: false,
        message: "Payment gateway is not configured"
      });
    }

    // -----------------------------
    // Webhook URL
    //
    // IMPORTANT:
    // Replace this with your real
    // deployed webhook URL.
    // -----------------------------
    const webhookUrl =
      process.env.ZAPUPI_WEBHOOK_URL || "";

    // -----------------------------
    // Create ZapUPI request
    // -----------------------------
    const payload = {
      zap_key: zapKey,

      // Must be unique
      order_id: String(order_id),

      // INR amount
      amount: numericAmount.toFixed(2)
    };

    if (customer_mobile) {
      payload.customer_mobile = String(customer_mobile);
    }

    if (remark) {
      payload.remark = String(remark);
    }

    if (webhookUrl) {
      payload.webhook_url = webhookUrl;
    }

    console.log("Creating ZapUPI order:", {
      order_id: payload.order_id,
      amount: payload.amount
    });

    // -----------------------------
    // Call ZapUPI
    // -----------------------------
    const response = await fetch(
      "https://pay.zapupi.com/api/create-order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const rawText = await response.text();

    let data;

    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("Invalid ZapUPI response:", rawText);

      return res.status(502).json({
        success: false,
        message: "Invalid response from payment gateway"
      });
    }

    console.log("ZapUPI response:", {
      http_status: response.status,
      status: data?.status,
      message: data?.message,
      has_payment_url: Boolean(data?.payment_url)
    });

    // -----------------------------
    // Gateway returned an error
    // -----------------------------
    if (!response.ok || data?.status === "error") {
      return res.status(response.status >= 400 ? response.status : 400).json({
        success: false,
        message: data?.message || "Unable to create payment order"
      });
    }

    // -----------------------------
    // Payment URL is required
    // -----------------------------
    if (!data?.payment_url) {
      console.error(
        "ZapUPI success response did not contain payment_url:",
        data
      );

      return res.status(502).json({
        success: false,
        message: "Payment URL was not returned by ZapUPI"
      });
    }

    // -----------------------------
    // SUCCESS
    // -----------------------------
    return res.status(200).json({
      success: true,
      message: data?.message || "Order created successfully",
      order_id: String(order_id),
      payment_url: data.payment_url
    });

  } catch (error) {
    console.error("ZapUPI Create Order Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create payment order"
    });
  }
}
