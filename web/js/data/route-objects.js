// Objects that always follow a route (POTI). The game reads the route without
// checking it: with route 0xFFFF such an object reads address 0 and crashes
// ("Invalid read from 0x00000000").
//
// The object documentation says it with "route": { "required": true | false }.
// When an object's documentation does not say, this list is used: the
// OBF_ALWAYS_ROUTE objects of the object database of Wiimm's SZS Tools
// (project/src/db-object.c), so the check also works with older documentation.
import { make } from '../formats/kmp.js';

export const ROUTE_REQUIRED_OBJECTS = new Set([
  0x005, 0x006, 0x008, 0x009, 0x00a, 0x00b, 0x00c, 0x00d, 0x00e, 0x010, 0x015, // sound_* emitters
  0x072, // sunDS
  0x0c9, 0x0ca, 0x0cc, 0x0cd, 0x0ce, 0x0cf, 0x0d0, 0x0d1, 0x0d2, 0x0d3, 0x0d4, 0x0d5, 0x0d6, 0x0d7,
  0x0d8, 0x0d9, 0x0da, 0x0dd, 0x0de, 0x0e2, 0x0e3, 0x0e4, 0x0e5, 0x0e7, 0x0e8, 0x0e9, 0x0eb, 0x0ec,
  0x0ed, 0x0ee, 0x149, 0x192, 0x193, 0x198, 0x199, 0x19b, 0x19c, 0x200,
]);

// documentation: (objectId) => the object's documentation (objectDocumentation()), or null.
export function routeRequired(objectId, documentation = null) {
  const said = documentation?.(objectId)?.route?.required;
  return typeof said === 'boolean' ? said : ROUTE_REQUIRED_OBJECTS.has(objectId);
}

export const objectNeedsRoute = (object, documentation = null) => object.route === 0xFFFF && routeRequired(object.objectId, documentation);

// A short two-point route that starts at the object and runs 1000 units in the
// direction it faces, so the object stays where it was placed.
export function routeForObject(object) {
  const yaw = ((object.rot?.[1] ?? 0) * Math.PI) / 180, [x, y, z] = object.pos;
  return make.route([make.routePoint([x, y, z]), make.routePoint([x + Math.sin(yaw) * 1000, y, z + Math.cos(yaw) * 1000])]);
}

// Gives every route-following object without a route its own route. Returns how many were fixed.
export function addMissingObjectRoutes(kmp, documentation = null) {
  let fixed = 0;
  for (const object of kmp.GOBJ) if (objectNeedsRoute(object, documentation)) {
    kmp.POTI.push(routeForObject(object));
    object.route = kmp.POTI.length - 1;
    fixed++;
  }
  return fixed;
}

// Settings the documentation marks "required" that are still 0.
export function missingRequiredSettings(object, documentation = null) {
  const settings = documentation?.(object.objectId)?.settings || {};
  return Object.entries(settings)
    .filter(([index, setting]) => setting?.required && !object.settings[Number(index) - 1])
    .map(([index, setting]) => ({ index: Number(index), label: setting.label }));
}
