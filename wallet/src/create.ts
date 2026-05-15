import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { walletExists, getAddress, encryptAndStore } from "./keystore.js";

const password = process.argv[2];

if (walletExists()) {
  const address = getAddress();
  console.log(JSON.stringify({ status: "exists", address }));
  process.exit(0);
}

if (!password) {
  console.error(JSON.stringify({ error: "Password required as first argument" }));
  process.exit(1);
}

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

encryptAndStore(privateKey, account.address, password);

console.log(
  JSON.stringify({
    status: "created",
    address: account.address,
  }),
);
