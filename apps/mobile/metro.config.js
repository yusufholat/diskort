// Expo monorepo ayarlarını kendisi yapar. Tek ek: ortak paketler (@diskort/client-core) React ve
// zustand'ı kendi klasörlerinden değil uygulamanınkinden almalı; iki React kopyası kancaları bozar.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const SINGLETONS = ['react', 'zustand'];
const appEntry = path.join(__dirname, 'index.ts');
const upstream = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const singleton = SINGLETONS.some((name) => moduleName === name || moduleName.startsWith(`${name}/`));
  const ctx = singleton ? { ...context, originModulePath: appEntry } : context;
  return upstream ? upstream(ctx, moduleName, platform) : ctx.resolveRequest(ctx, moduleName, platform);
};

module.exports = config;
