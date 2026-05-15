import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
} from "crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  chmodSync,
} from "fs";
import { WALLET_DIR, KEYSTORE_PATH, ADDRESS_PATH } from "./config.js";

interface Keystore {
  address: string;
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: string;
    kdfparams: {
      n: number;
      r: number;
      p: number;
      dklen: number;
      salt: string;
    };
    mac: string;
  };
}

export function walletExists(): boolean {
  return existsSync(KEYSTORE_PATH);
}

export function getAddress(): string | null {
  if (!existsSync(ADDRESS_PATH)) return null;
  return readFileSync(ADDRESS_PATH, "utf-8").trim();
}

export function encryptAndStore(
  privateKey: string,
  address: string,
  password: string,
): void {
  if (!existsSync(WALLET_DIR)) {
    mkdirSync(WALLET_DIR, { recursive: true, mode: 0o700 });
  }

  const salt = randomBytes(32);
  const iv = randomBytes(16);
  const kdfN = 2 ** 14;
  const key = scryptSync(password, salt, 32, { N: kdfN, r: 8, p: 1 });

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  let ciphertext = cipher.update(privateKey, "utf-8", "hex");
  ciphertext += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  const keystore: Keystore = {
    address,
    crypto: {
      cipher: "aes-256-gcm",
      ciphertext,
      cipherparams: { iv: iv.toString("hex") },
      kdf: "scrypt",
      kdfparams: {
        n: kdfN,
        r: 8,
        p: 1,
        dklen: 32,
        salt: salt.toString("hex"),
      },
      mac: authTag,
    },
  };

  writeFileSync(KEYSTORE_PATH, JSON.stringify(keystore, null, 2), {
    mode: 0o600,
  });
  writeFileSync(ADDRESS_PATH, address, { mode: 0o600 });
  chmodSync(WALLET_DIR, 0o700);
}

export function decrypt(password: string): string {
  const keystore: Keystore = JSON.parse(
    readFileSync(KEYSTORE_PATH, "utf-8"),
  );
  const { ciphertext, cipherparams, kdfparams, mac } = keystore.crypto;

  const salt = Buffer.from(kdfparams.salt, "hex");
  const iv = Buffer.from(cipherparams.iv, "hex");
  const key = scryptSync(password, salt, kdfparams.dklen, {
    N: kdfparams.n,
    r: kdfparams.r,
    p: kdfparams.p,
  });

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(mac, "hex"));
  let decrypted = decipher.update(ciphertext, "hex", "utf-8");
  decrypted += decipher.final("utf-8");
  return decrypted;
}
