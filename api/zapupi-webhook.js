import { getAdmin } from './_firebaseAdmin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const payload = req.body || {};
    const orderId = String(payload.order_id || '');
    if (!orderId) return res.status(400).json({ success: false, message: 'order_id is required' });

    const { db } = getAdmin();
    const orderRef = db.ref(`paymentOrders/${orderId}`);
    const orderSnap = await orderRef.once('value');
    if (!orderSnap.exists()) return res.status(404).json({ success: false, message: 'Order not found' });

    const order = orderSnap.val();
    if (order.status === 'paid') return res.status(200).json({ success: true, message: 'Already processed' });

    // Do not trust the webhook status/amount alone. Ask ZapUPI for the order status.
    const verifyResponse = await fetch('https://pay.zapupi.com/api/order-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zap_key: process.env.ZAPUPI_KEY, order_id: orderId })
    });
    const verify = await verifyResponse.json().catch(() => ({}));
    const verifiedStatus = String(verify.status || verify.data?.status || '').toLowerCase();
    const verifiedAmount = Number(verify.amount ?? verify.data?.amount ?? verify.pay_amount ?? verify.data?.pay_amount);

    if (!verifyResponse.ok || verifiedStatus !== 'success' || !Number.isFinite(verifiedAmount) || verifiedAmount !== Number(order.amount)) {
      await orderRef.update({ lastWebhook: payload, lastVerification: verify, status: 'verification_failed', verifiedAt: Date.now() });
      return res.status(400).json({ success: false, message: 'Payment could not be verified' });
    }

    const uid = order.uid;
    const userRef = db.ref(`users/${uid}`);
    const txResult = await userRef.transaction(profile => {
      if (!profile) return profile;
      profile.balance = Number(profile.balance || 0) + Number(order.amount);
      return profile;
    });
    if (!txResult.committed) throw new Error('Wallet transaction was not committed');

    const transactionKey = db.ref(`transactions/${uid}`).push().key;
    await db.ref(`transactions/${uid}/${transactionKey}`).set({
      type: 'wallet_recharge',
      amount: Number(order.amount),
      description: 'Wallet Recharge via ZapUPI',
      orderId,
      txnId: payload.txn_id || verify.txn_id || verify.data?.txn_id || null,
      utr: payload.utr || verify.utr || verify.data?.utr || null,
      paymentGateway: 'ZapUPI',
      timestamp: Date.now()
    });

    await orderRef.update({ status: 'paid', paidAt: Date.now(), webhook: payload, verification: verify });
    return res.status(200).json({ success: true, message: 'Payment verified and wallet credited' });
  } catch (error) {
    console.error('ZapUPI webhook error:', error);
    return res.status(500).json({ success: false, message: 'Webhook processing failed' });
  }
}
