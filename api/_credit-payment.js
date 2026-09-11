const getFirebase = require('./_firebase');

async function creditPayment({ uid, paymentId, orderId, amount }) {
  const admin = getFirebase();
  const db = admin.database();
  const amountRupees = Number(amount);

  if (
    !uid ||
    !paymentId ||
    !orderId ||
    !Number.isFinite(amountRupees) ||
    amountRupees <= 0
  ) {
    throw new Error('Invalid payment credit data.');
  }

  const userRef = db.ref(`users/${uid}`);

  let alreadyCredited = false;
  let newBalance = null;

  // Balance + payment ID ek hi transaction me update hoga.
  // Isse same payment dobara credit nahi hoga.
  const result = await userRef.transaction((user) => {
    if (!user) return user;

    const processed = user.processedRazorpayPayments || {};

    if (processed[paymentId]) {
      alreadyCredited = true;
      newBalance = Number(user.balance || 0);
      return user;
    }

    const currentBalance = Number(user.balance || 0);
    newBalance = currentBalance + amountRupees;

    return {
      ...user,
      balance: newBalance,
      processedRazorpayPayments: {
        ...processed,
        [paymentId]: {
          amount: amountRupees,
          orderId,
          creditedAt: Date.now()
        }
      }
    };
  });

  if (!result.committed || !result.snapshot.exists()) {
    throw new Error('User wallet could not be updated.');
  }

  // Transaction history
  const txRef = db.ref(`transactions/${uid}/${paymentId}`);
  const txSnapshot = await txRef.once('value');

  if (!txSnapshot.exists()) {
    await txRef.set({
      type: 'credit',
      amount: amountRupees,
      description: 'Wallet Recharge - Razorpay',
      method: 'Razorpay',
      paymentId,
      orderId,
      status: 'success',
      timestamp: Date.now(),
      balanceAfter: newBalance
    });
  }

  // Audit record
  await db.ref(`paymentCredits/${paymentId}`).set({
    uid,
    amount: amountRupees,
    orderId,
    paymentId,
    status: 'credited',
    createdAt: Date.now()
  });

  return {
    alreadyCredited,
    amount: amountRupees,
    balance: newBalance
  };
}

module.exports = creditPayment;
