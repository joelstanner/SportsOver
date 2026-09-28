"use strict";

(function initializeSportsRegistry(global) {
  const providers = new Map();
  const layouts = new Map();

  function registerProvider(name, provider) {
    providers.set(normalizeName(name), provider);
  }

  function registerLayout(sport, layout) {
    layouts.set(normalizeName(sport), layout);
  }

  function getProvider(name) {
    return getRegistered(providers, "provider", name);
  }

  function getLayout(sport) {
    return getRegistered(layouts, "layout", sport);
  }

  function getRegistered(collection, kind, name) {
    const key = normalizeName(name);
    if (!collection.has(key)) throw new Error(`No ${kind} registered for ${key}.`);
    return collection.get(key);
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.registry = Object.freeze({
    registerProvider,
    registerLayout,
    getProvider,
    getLayout,
  });
})(typeof window === "undefined" ? globalThis : window);
