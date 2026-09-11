const crypto = require('crypto');
const Razorpay = require('razorpay');
const getRawBody = require('raw-body');
const getFirebase = require('./_firebase');
const creditPayment = require('./_credit-payment');

module.exports.config = {
  api: {
    bodyParser: false
  }
};

function safeEqualHex(expected, received) {
  if (!expected || !received || expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(received, 'utf8')
  );
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await getRawBody(req, { encoding: 'utf8' });
    const signature = req.headers['x-razorpay-signature'];

    if (!signature) {
      return res.status(400).json({ error: 'Missing webhook signature.' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!safeEqualHex(expected, signature)) {
      return res.status(400).json({ error: 'Invalid webhook signature.' });
    }

    const event = JSON.parse(rawBody);

    if (event.event !== 'payment.captured') {
      return res.status(200).json({
        received: true,
        ignored: true
      });
    }

    const paymentEntity = event.payload?.payment?.entity;

    if (
      !paymentEntity?.id ||
      !paymentEntity?.order_id ||
      paymentEntity.status !== 'captured'
    ) {
      return res.status(400).json({
        error: 'Invalid captured-payment payload.'
      });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });

    const order = await razorpay.orders.fetch(paymentEntity.order_id);
    const uid = order.notes?.uid;

    if (!uid || order.notes?.purpose !== 'wallet_recharge') {
      return res.status(400).json({
        error: 'Payment order is not a wallet recharge.'
      });
    }

    if (Number(paymentEntity.amount) !== Number(order.amount)) {
      return res.status(400).json({
        error: 'Payment amount mismatch.'
      });
    }

    const result = await creditPayment({
      uid,
      paymentId: paymentEntity.id,
      orderId: order.id,
      amount: Number(order.amount) / 100
    });

    return res.status(200).json({
      received: true,
      credited: !result.alreadyCredited,
      alreadyCredited: result.alreadyCredited
    });

  } catch (error) {
    console.error('RAZORPAY WEBHOOK ERROR:', error);

    return res.status(500).json({
      error: 'Webhook processing failed.'
    });
  }
};
