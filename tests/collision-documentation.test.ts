import { expect, test } from "bun:test";
import { collisionDocumentation, courseKey, documentedCourses, parseCollisionDocumentation } from "../web/js/data/collision-documentation.js";
import { collisionGroups, collisionPieces } from "../web/js/editor/collision-groups.js";
import { gateAcross, gateFacing, gatePair, routeDirection } from "../web/js/editor/trigger-gate.js";

test("the default documentation says what Sound Trigger variants do on a course", () => {
  expect(courseKey("C:/x/water_course_d.szs")).toBe("water_course");
  const koopa = collisionDocumentation(0x18, "water_course.szs");
  expect(koopa.label).toBe("Sound Trigger");
  expect(koopa.track).toBe("Koopa Cape");
  expect(koopa.variants[3]).toMatchObject({ label: "Underwater music", onTrack: true });
  // Elsewhere the variants are not documented, but the courses that document them are known.
  expect(collisionDocumentation(0x18, "beginner_course.szs").variants[3]).toBeUndefined();
  expect(documentedCourses(0x18).map((c: any) => c.course)).toContain("water_course");
});

test("a person's collision entries complete the default ones", () => {
  const custom = parseCollisionDocumentation({
    "0x18": { notes: "Mine.", tracks: { My_Course: { label: "My track", variants: { "1": { label: "Cave music" } } } } },
    "12": { variants: { "0": { label: "Plain wall" } } },
  });
  const mine = collisionDocumentation(0x18, "my_course.szs", custom);
  expect(mine.notes).toBe("Mine.");
  expect(mine.description).toContain("drive through");
  expect(mine.variants[1]).toMatchObject({ label: "Cave music", onTrack: true });
  expect(collisionDocumentation(0x0c, "", custom).variants[0].label).toBe("Plain wall");
  expect(() => parseCollisionDocumentation({ "0x20": { label: "x" } })).toThrow();
  expect(() => parseCollisionDocumentation({ "0x18": { variants: { "8": { label: "x" } } } })).toThrow();
  expect(() => parseCollisionDocumentation({ "0x18": {} })).toThrow();
});

// Two triangles sharing an edge (one piece) and one apart; flags: road, and Sound Trigger variant 3 twice.
const kcl = {
  count: 3,
  verts: new Float32Array([0, 0, 0, 100, 0, 0, 0, 0, 100, 100, 0, 0, 100, 0, 100, 0, 0, 100, 5000, 0, 0, 5100, 0, 0, 5000, 0, 100]),
  flags: new Uint16Array([0x18 | (3 << 5), 0x18 | (3 << 5), 0x00]),
};

test("the collision is listed by type, variant and joined pieces", () => {
  const groups = collisionGroups(kcl);
  expect([...groups.keys()]).toEqual([0x00, 0x18]);
  expect(groups.get(0x18).variants.get(3)).toEqual([0, 1]);
  const pieces = collisionPieces(kcl, [0, 1, 2]);
  expect(pieces.map((p: any) => p.tris)).toEqual([[0, 1], [2]]);
});

test("which way a trigger gate faces, from the enemy route", () => {
  const enpt = [{ points: [{ pos: [0, 0, 0] }, { pos: [0, 0, 1000] }, { pos: [0, 0, 2000] }] }];
  expect(routeDirection(enpt, [10, 0, 1000])).toEqual([0, 2000]);
  expect(routeDirection(enpt, [90000, 0, 0])).toBeNull();
  const road = () => ({ y: 0, type: 0, normalY: 1 });
  const gate = gateAcross([0, 0, 1000], [0, 1], (x: number) => (Math.abs(x) < 800 ? road() : null));
  const [back1, back2, front1, front2] = gatePair(gate, 3, 0);
  const sum = (a: any, b: any) => { const n = collisionPieces({ count: 2, verts: new Float32Array([...a.tri, ...b.tri]), flags: new Uint16Array(2) }, [0, 1])[0].normal; return n; };
  expect(gateFacing(sum(front1, front2), [0, 1])).toBe("toward");
  expect(gateFacing(sum(back1, back2), [0, 1])).toBe("ahead");
  expect(gateFacing([0, 1, 0], [0, 1])).toBe("flat");
  expect(gateFacing([1, 0, 0], [0, 1])).toBe("sideways");
  expect(gateFacing([0, 0, 1], null)).toBe("upright");
});
