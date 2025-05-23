const crypto = require('crypto');
const bip39 = require('bip39');
const bitcoinjs = require('bitcoinjs-lib');

const digibyteNetwork = {
  messagePrefix: '\x19DigiByte Signed Message:\n',
  bech32: 'dgb',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x1e,
  scriptHash: 0x32,
  wif: 0x80,
};

// Generate a 24-word mnemonic
const mnemonic = bip39.generateMnemonic(256, crypto.randomBytes);
console.log("Mnemonic (24 words):", mnemonic);

// Create a seed from the mnemonic
const seed = bip39.mnemonicToSeedSync(mnemonic);

// Generate a DigiByte wallet using the seed
const root = bitcoinjs.bip32.fromSeed(seed, digibyteNetwork);
const path = "m/44'/20'/0'/0/0"; // DigiByte BIP44 path
const child = root.derivePath(path);

// Generate a DigiByte address
const { address } = bitcoinjs.payments.p2pkh({
  pubkey: child.publicKey,
  network: digibyteNetwork,
});

console.log("DigiByte Address:", address);
