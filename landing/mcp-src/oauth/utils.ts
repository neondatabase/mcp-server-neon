import crypto from "crypto";

export const generateRandomString = (length: number): string => {
  const charset =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => charset[byte % charset.length]).join("");
};

export const verifyPKCE = (
  codeChallenge: string,
  codeChallengeMethod: string,
  codeVerifier: string,
): boolean => {
  if (!codeChallenge || !codeChallengeMethod || !codeVerifier) {
    return false;
  }

  if (codeChallengeMethod === "S256") {
    const hash = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");
    return codeChallenge === hash;
  }

  if (codeChallengeMethod === "plain") {
    return codeChallenge === codeVerifier;
  }

  return false;
};
