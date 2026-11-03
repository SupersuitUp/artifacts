// Firestore, Storage and Auth for the hub, through Application Default Credentials: on App Hosting
// that is the backend's own runtime service account, so no key is stored anywhere. For a local run,
// FIREBASE_SERVICE_ACCOUNT_KEY (one line of service account JSON) is used instead when it is set.
import { initializeApp, getApps, cert, applicationDefault, type ServiceAccount } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getAuth, type Auth } from 'firebase-admin/auth'
import type { Bucket } from '@google-cloud/storage'

let _db: Firestore | null = null
let _bucket: Bucket | null = null
let _privateBucket: Bucket | null = null

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0]
  const key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()
  const credential = key ? cert(JSON.parse(key) as ServiceAccount) : applicationDefault()
  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined
  return initializeApp({ credential, ...(storageBucket ? { storageBucket } : {}) })
}

export function getAdminDb(): Firestore {
  return (_db ??= getFirestore(getAdminApp()))
}

/** The project's default bucket (FIREBASE_STORAGE_BUCKET): public page media. */
export function getAdminBucket(): Bucket {
  return (_bucket ??= getStorage(getAdminApp()).bucket() as unknown as Bucket)
}

/**
 * The bucket private media (`media: private`) lives in, named by ARTIFACT_PRIVATE_BUCKET. It must
 * not be the public bucket: that one carries a bucket-wide public read grant. Unset or blank means
 * no private store, and the package then refuses private media instead of making it public.
 */
export function getAdminPrivateBucket(): Bucket | undefined {
  const name = process.env.ARTIFACT_PRIVATE_BUCKET?.trim()
  if (!name || name === '__SET_BY_SETUP__') return undefined
  if (_privateBucket?.name !== name) _privateBucket = getStorage(getAdminApp()).bucket(name) as unknown as Bucket
  return _privateBucket
}

/** ID-token verification for readers signing in on this host (src/lib/local-sign-in.ts). */
export function getAdminAuth(): Auth {
  return getAuth(getAdminApp())
}
