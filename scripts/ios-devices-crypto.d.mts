// scripts/ios-devices-crypto.mjs için türler (sunucu testleri içe aktarır)
export declare function parseKey(text: string): Buffer;
export declare function encryptDevices(devices: unknown[], key: Buffer): string;
export declare function decryptDevices(payload: string, key: Buffer): { udid: string; name?: string }[];
