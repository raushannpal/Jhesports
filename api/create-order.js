import { getAdmin } from './_firebaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Login required' });

    const { auth, db } = getAdmin();
    const decoded = await auth.verifyIdToken(authHeader.slice(7));
    const amount = Number(req.body?.amount);
    const customerMobile = String(req.body?.customer_mobile || '');

    if (!Number.isFinite(amount) || amount < 10 || amount > 1000) {
      return res.status(400).json({ success: false, message: 'Amount must be between ₹10 and ₹1000' });
    }
    if (!process.env.ZAPUPI_KEY) return res.status(500).json({ success: false, message: 'ZAPUPI_KEY is not configured' });
    if (!process.env.ZAPUPI_WEBHOOK_URL) return res.status(500).json({ success: false, message: 'ZAPUPI_WEBHOOK_URL is not configured' });

    const orderId = `ORD_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const cleanAmount = Number(amount.toFixed(2));

    await db.ref(`paymentOrders/${orderId}`).set({
      uid: decoded.uid,
      amount: cleanAmount,
      status: 'pending',
      gateway: 'ZapUPI',
      createdAt: Date.now()
    });

    const gatewayResponse = await fetch('https://pay.zapupi.com/api/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zap_key: process.env.ZAPUPI_KEY,
        order_id: orderId,
        amount: cleanAmount.toFixed(2),
        ...(customerMobile ? { customer_mobile: customerMobile } : {}),
        remark: 'JH Esports Wallet Recharge',
        webhook_url: process.env.ZAPUPI_WEBHOOK_URL
      })
    });

    const data = await gatewayResponse.json().catch(() => ({}));
    const paymentUrl = data.payment_url;
    if (!gatewayResponse.ok || data.status !== 'success' || !paymentUrl) {
      await db.ref(`paymentOrders/${orderId}`).update({ status: 'gateway_error', gatewayResponse: data });
      return res.status(502).json({ success: false, message: data.message || 'ZapUPI did not return a payment URL' });
    }

    await db.ref(`paymentOrders/${orderId}`).update({ paymentUrl });
    return res.status(200).json({ success: true, order_id: orderId, payment_url: paymentUrl });
  } catch (error) {
    console.error('Create order error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create payment order' });
  }
}
