import { expect, test } from "bun:test";
import { kartArchiveLabel } from "../web/js/editor/kart-archives.js";

test("kart archives show a character and vehicle while retaining filename search", () => {
  expect(kartArchiveLabel("la_bike-bk.szs")).toEqual({
    character: "Dry Bowser", detail: "Flame Runner - 1P", search: "dry bowser flame runner - 1p la_bike-bk.szs",
  });
  expect(kartArchiveLabel("mdf_kart-mr_2.szs")?.detail).toBe("Standard Kart M - 2P");
  expect(kartArchiveLabel("sdf_kart-sa_mii_f_4.szs")?.character).toBe("Small Mii Outfit A (Female)");
  expect(kartArchiveLabel("ldf_bike_blue-fk.szs")?.detail).toBe("Standard Bike L (blue) - 1P");
  expect(kartArchiveLabel("course.szs")).toBeNull();
});
