/**
 * Copy a mixin class's methods onto a target prototype, verbatim.
 *
 * The controller (ContactRelationshipApp) is split across several modules. Each
 * module defines a plain class holding a cohesive group of methods (moved from
 * app.js unchanged) and calls this to graft them onto the real prototype. Using
 * property descriptors preserves the methods' non-enumerable nature (same as
 * native class methods) and avoids touching call sites — `this` is still the app
 * instance at call time.
 */
export function applyMixin(targetPrototype, MixinClass) {
  const descriptors = Object.getOwnPropertyDescriptors(MixinClass.prototype);
  delete descriptors.constructor;
  Object.defineProperties(targetPrototype, descriptors);
}
