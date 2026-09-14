import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

function getAdmin() {
  if (!getApps().length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey || !process.env.FIREBASE_DATABASE_URL) {
      throw new Error('Firebase Admin environment variables are incomplete');
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  }

  return {
    auth: getAuth(),
    db: getDatabase()
  };
}

export { getAdmin };
