import { expect, test } from "bun:test";
import { buildRiivolution, checkRiivolution, dolphinLauncher, externalPath, fileItem, folderItem, modSlug, newRiivolutionMod, parseRiivolution } from "../web/js/formats/riivolution.js";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<!-- A typical custom track pack -->
<wiidisc version="1" root="/MKF">
  <id game="RMC"><region type="P" /><region type="E" /></id>
  <options>
    <section name="MKF CT Pack">
      <option name="MKF" id="mkf" default="1">
        <choice name="Enabled"><patch id="main" /><patch id="code"><param name="region" value="P" /></patch></choice>
      </option>
      <option name="My Stuff Folder">
        <choice name="Enabled"><patch id="mystuff" /></choice>
      </option>
    </section>
  </options>
  <patch id="main" root="/MKF">
    <file disc="/Race/Course/beginner_course.szs" external="Course/luigi &amp; co.szs" />
    <folder external="/MKF/My Stuff" disc="/" recursive="false" />
  </patch>
  <patch id="code"><memory offset="0x80001234" value="60000000" original="4E800020" /></patch>
  <patch id="mystuff"><folder external="/MKF/My Stuff" recursive="false" /></patch>
  <network protocol="tcp" />
</wiidisc>`;

test("an existing Riivolution XML is read and written back without losing anything", () => {
  const mod = parseRiivolution(SAMPLE);
  expect(mod.game).toBe("RMC");
  expect(mod.regions).toEqual(["P", "E"]);
  expect(mod.attrs.root).toBe("/MKF");
  expect(mod.sections[0].name).toBe("MKF CT Pack");
  expect(mod.sections[0].options.map((o: any) => o.attrs.name)).toEqual(["MKF", "My Stuff Folder"]);
  expect(mod.sections[0].options[0].choices[0].patches[1]).toEqual({ id: "code", attrs: {}, params: [{ name: "region", value: "P" }] });
  expect(mod.patches.map((p: any) => p.attrs.id)).toEqual(["main", "code", "mystuff"]);
  expect(mod.patches[0].items[0].attrs.external).toBe("Course/luigi & co.szs");
  expect(mod.patches[1].items[0]).toMatchObject({ tag: "memory", attrs: { offset: "0x80001234", value: "60000000" } });

  const again = parseRiivolution(buildRiivolution(mod));
  const strip = (m: any) => JSON.parse(JSON.stringify(m));
  expect(strip(again)).toEqual(strip(mod));
  expect(buildRiivolution(mod)).toContain('external="Course/luigi &amp; co.szs"');
  expect(buildRiivolution(mod)).toContain('<network protocol="tcp" />');
  expect(checkRiivolution(mod)).toEqual([]);
});

test("a new mod turns the edited files on with one option and places them by their disc path", () => {
  const mod = newRiivolutionMod("Red Item Box!", [{ disc: "/Race/Course/beginner_course.szs", source: "C:\\game\\files\\Race\\Course\\beginner_course.szs" }]);
  expect(modSlug("Red Item Box!")).toBe("RedItemBox");
  expect(mod.patches[0].attrs).toEqual({ id: "RedItemBox", root: "/RedItemBox" });
  expect(mod.patches[0].items[0].attrs).toEqual({ disc: "/Race/Course/beginner_course.szs", external: "Race/Course/beginner_course.szs" });
  expect(externalPath(mod.patches[0], mod.patches[0].items[0])).toBe("RedItemBox/Race/Course/beginner_course.szs");
  const xml = buildRiivolution(mod);
  expect(xml).toContain('<id game="RMC" />');
  expect(xml).toContain('<option name="Enabled" id="RedItemBoxEnabled" default="1">');
  expect(xml).not.toContain("C:\\game"); // the local source is not part of the XML
  expect(checkRiivolution(mod)).toEqual([]);

  expect(folderItem("Race/Course/").attrs).toEqual({ disc: "/Race/Course", external: "Race/Course", create: "true" });
  expect(externalPath({ attrs: { root: "/MKF" } }, { attrs: { external: "/Other/x.szs" } })).toBe("Other/x.szs");
  expect(fileItem("\\Scene\\UI\\Font.szs").attrs.disc).toBe("/Scene/UI/Font.szs");

  const launcher = dolphinLauncher(mod, { name: "Red Item Box", baseFile: "D:/MKW.wbfs", sdRoot: "D:/sd", xmlPath: "D:/sd/riivolution/RedItemBox.xml" });
  expect(launcher.riivolution.patches[0].options).toEqual([{ choice: 1, "option-name": "Enabled", "section-name": "Red Item Box!" }]);
  expect(launcher.type).toBe("dolphin-game-mod-descriptor");
});

test("problems that keep a mod from working are reported", () => {
  const mod = newRiivolutionMod("Test", []);
  mod.game = "";
  mod.sections[0].options[0].choices[0].patches.push({ id: "missing", attrs: {}, params: [] });
  mod.patches.push({ attrs: { id: "Test" }, items: [{ tag: "file", attrs: { disc: "/a" } }] });
  const problems = checkRiivolution(mod);
  expect(problems).toContain("Set the game ID (RMC for Mario Kart Wii).");
  expect(problems).toContain('Option "Enabled" uses the missing patch "missing".');
  expect(problems).toContain('Two patches use the ID "Test".');
  expect(problems).toContain('A file of "Test" has no path in the mod folder.');
  expect(() => parseRiivolution("<xml/>")).toThrow();
});
