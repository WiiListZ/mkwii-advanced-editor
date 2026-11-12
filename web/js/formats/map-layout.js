// The race screen's layout for the minimap (Scene/UI/Race.szs). Its picture pane race_null has four
// corner colours that the game multiplies the map by (https://mkwiiki.org/wiki/Minimap).

export const MAP_LAYOUT = 'game_image/blyt/common_w040_map_set_position.brlyt';
const PANE_NAME = 'race_null';
const NAME_AT = 0x0C; // inside a pane, after its magic, size, flags and alpha
const COLOURS_AT = 0x4C;

// The offset of the pic1 section of race_null.
function panePosition(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = view.getUint16(0x0C);
  const sections = view.getUint16(0x0E);
  for (let i = 0; i < sections && at + 8 <= data.length; i++) {
    const magic = String.fromCharCode(data[at], data[at + 1], data[at + 2], data[at + 3]), size = view.getUint32(at + 4);
    if (magic === 'pic1') {
      let name = '';
      for (let c = 0; c < 16 && data[at + NAME_AT + c]; c++) name += String.fromCharCode(data[at + NAME_AT + c]);
      if (name === PANE_NAME) return at + COLOURS_AT;
    }
    at += size;
  }
  throw new Error(`The layout has no ${PANE_NAME} picture`);
}

// Top left, top right, bottom left, bottom right.
export function readMapColours(data) {
  const at = panePosition(data);
  return [0, 1, 2, 3].map((i) => [...data.slice(at + i * 4, at + i * 4 + 4)]);
}

export function setMapColours(data, colours) {
  if (colours.length !== 4 || colours.some((c) => c.length !== 4 || c.some((v) => !Number.isInteger(v) || v < 0 || v > 255))) throw new Error('Invalid colours');
  const out = data.slice(), at = panePosition(out);
  colours.forEach((c, i) => out.set(c, at + i * 4));
  return out;
}
