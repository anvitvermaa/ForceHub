// db.js — Lightweight Firestore REST API client for tracking users
// Using the REST API avoids bundling the massive Firebase JS SDK into the extension.

const FIREBASE_PROJECT_ID = "forcehub-e6b6b";
const FIREBASE_API_KEY = "AIzaSyAQPimsM1pmopjfZNd9UiAPiBMXpCOFx7o";

export async function trackUserSync(handle, repoFullName, solvedCount) {
  if (!handle) return;
  
  // Use the Codeforces handle as the document ID
  const documentId = encodeURIComponent(handle);
  
  // The Firestore REST API URL for updating a document
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/users/${documentId}?key=${FIREBASE_API_KEY}`;
  
  // Firestore REST API requires a specific payload structure specifying data types
  const payload = {
    fields: {
      handle: { stringValue: handle },
      repoFullName: { stringValue: repoFullName || "" },
      solvedCount: { integerValue: String(solvedCount || 0) },
      lastSyncTime: { timestampValue: new Date().toISOString() },
      version: { stringValue: chrome.runtime.getManifest().version }
    }
  };

  try {
    const res = await fetch(url, {
      method: "PATCH", // PATCH creates the document if it doesn't exist, or updates it
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      console.error("[ForceHub] Failed to track user in Firestore:", res.status, await res.text());
    }
  } catch (err) {
    console.error("[ForceHub] Network error tracking user:", err);
  }
}
