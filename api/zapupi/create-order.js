export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    const { order_id, amount, customer_mobile, remark } = req.body || {};

    if (!order_id || !amount) {
      return res.status(400).json({
        success: false,
        message: "order_id and amount are required"
      });
    }

    if (!process.env.ZAPUPI_KEY) {
      return res.status(500).json({
        success: false,
        message: "ZAPUPI_KEY is not configured"
      });
    }

    const response = await fetch(
      "https://pay.zapupi.com/api/create-order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          zap_key: process.env.ZAPUPI_KEY,
          order_id: String(order_id),
          amount: String(amount),
          ...(customer_mobile
            ? { customer_mobile: String(customer_mobile) }
            : {}),
          ...(remark ? { remark: String(remark) } : {})
        })
      }
    );

    const data = await response.json();

    return res.status(response.status).json(data);

  } catch (error) {
    console.error("ZapUPI Create Order Error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create payment order"
    });
  }
}
