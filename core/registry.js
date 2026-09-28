"use strict";

(function initializeSportsRegistry(global) {
  const providers = new Map();
  const layouts = new Map();
  const demos = new Map();

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

  function registerDemo(sport, name, createDemo) {
    demos.set(demoKey(sport, name), createDemo);
  }

  function getDemo(sport, name) {
    const createDemo = demos.get(demoKey(sport, name));
    return createDemo ? createDemo() : null;
  }

  function listDemos(sport) {
    const prefix = `${normalizeName(sport)}:`;
    return [...demos.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
  }

  function getRegistered(collection, kind, name) {
    const key = normalizeName(name);
    if (!collection.has(key)) throw new Error(`No ${kind} registered for ${key}.`);
    return collection.get(key);
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function demoKey(sport, name) {
    return `${normalizeName(sport)}:${normalizeName(name)}`;
  }

  global.SportsOverlay = global.SportsOverlay || {};
  global.SportsOverlay.registry = Object.freeze({
    registerProvider,
    registerLayout,
    registerDemo,
    getProvider,
    getLayout,
    getDemo,
    listDemos,
  });
})(typeof window === "undefined" ? globalThis : window);
