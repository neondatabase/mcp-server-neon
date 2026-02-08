import { cookies } from "next/headers";

const COOKIE_NAME = "approved-mcp-clients";
const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60; // 365 days in seconds

/**
 * Imports a secret key string for HMAC-SHA256 signing.
 */
const importKey = async (secret: string): Promise<CryptoKey> => {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
};

/**
 * Signs data using HMAC-SHA256.
 */
const signData = async (key: CryptoKey, data: string): Promise<string> => {
  const enc = new TextEncoder();
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    enc.encode(data),
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Verifies an HMAC-SHA256 signature.
 */
const verifySignature = async (
  key: CryptoKey,
  signatureHex: string,
  data: string,
): Promise<boolean> => {
  try {
    const enc = new TextEncoder();
    const signatureBytes = new Uint8Array(
      signatureHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );

    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes.buffer,
      enc.encode(data),
    );
  } catch (e) {
    console.error("Error verifying signature:", e);
    return false;
  }
};

/**
 * Parses the signed cookie and verifies its integrity.
 */
const getApprovedClientsFromCookie = async (
  cookie: string,
  secret: string,
): Promise<string[]> => {
  if (!cookie) return [];

  try {
    const [signatureHex, base64Payload] = cookie.split(".");
    if (!signatureHex || !base64Payload) return [];

    const payload = atob(base64Payload);
    const key = await importKey(secret);
    const isValid = await verifySignature(key, signatureHex, payload);
    if (!isValid) return [];

    const clients = JSON.parse(payload);
    return Array.isArray(clients) ? clients : [];
  } catch {
    return [];
  }
};

/**
 * Checks if a given client has already been approved by the user.
 */
export const isClientAlreadyApproved = async (
  clientId: string,
  cookieSecret: string,
): Promise<boolean> => {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME)?.value ?? "";
  const approvedClients = await getApprovedClientsFromCookie(
    cookie,
    cookieSecret,
  );
  return approvedClients.includes(clientId);
};

/**
 * Creates a signed cookie value with the updated approved clients list.
 */
const createApprovedClientsCookieValue = async (
  existingCookie: string,
  clientId: string,
  cookieSecret: string,
): Promise<string> => {
  const approvedClients = await getApprovedClientsFromCookie(
    existingCookie,
    cookieSecret,
  );
  const newApprovedClients = JSON.stringify(
    Array.from(new Set([...approvedClients, clientId])),
  );
  const key = await importKey(cookieSecret);
  const signature = await signData(key, newApprovedClients);
  return `${signature}.${btoa(newApprovedClients)}`;
};

/**
 * Updates the approved clients cookie with a new client ID.
 */
export const updateApprovedClientsCookie = async (
  clientId: string,
  cookieSecret: string,
): Promise<void> => {
  const cookieStore = await cookies();
  const existingCookie = cookieStore.get(COOKIE_NAME)?.value ?? "";
  const cookieValue = await createApprovedClientsCookieValue(
    existingCookie,
    clientId,
    cookieSecret,
  );

  cookieStore.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: ONE_YEAR_IN_SECONDS,
    path: "/",
  });
};
