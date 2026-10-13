const CHARACTERS = {
  mr: 'Mario', bpc: 'Baby Peach', wl: 'Waluigi', kp: 'Bowser', bds: 'Baby Daisy', ka: 'Dry Bones',
  bmr: 'Baby Mario', lg: 'Luigi', ko: 'Toad', dk: 'Donkey Kong', ys: 'Yoshi', wr: 'Wario',
  blg: 'Baby Luigi', kk: 'Toadette', nk: 'Koopa Troopa', ds: 'Daisy', pc: 'Peach', ca: 'Birdo',
  dd: 'Diddy Kong', kt: 'King Boo', jr: 'Bowser Jr.', bk: 'Dry Bowser', fk: 'Funky Kong', rs: 'Rosalina',
};

const VEHICLES = {
  sdf_kart: 'Standard Kart S', mdf_kart: 'Standard Kart M', ldf_kart: 'Standard Kart L',
  sa_kart: 'Booster Seat', ma_kart: 'Classic Dragster', la_kart: 'Offroader',
  sb_kart: 'Mini Beast', mb_kart: 'Wild Wing', lb_kart: 'Flame Flyer',
  sc_kart: 'Cheep Charger', mc_kart: 'Super Blooper', lc_kart: 'Piranha Prowler',
  sd_kart: 'Tiny Titan', md_kart: 'Daytripper', ld_kart: 'Jetsetter',
  se_kart: 'Blue Falcon', me_kart: 'Sprinter', le_kart: 'Honeycoupe',
  sdf_bike: 'Standard Bike S', mdf_bike: 'Standard Bike M', ldf_bike: 'Standard Bike L',
  sa_bike: 'Bullet Bike', ma_bike: 'Mach Bike', la_bike: 'Flame Runner',
  sb_bike: 'Bit Bike', mb_bike: 'Sugarscoot', lb_bike: 'Wario Bike',
  sc_bike: 'Quacker', mc_bike: 'Zip Zip', lc_bike: 'Shooting Star',
  sd_bike: 'Magikruiser', md_bike: 'Sneakster', ld_bike: 'Spear',
  se_bike: 'Jet Bubble', me_bike: 'Dolphin Dasher', le_bike: 'Phantom',
};

export function kartArchiveLabel(filename) {
  const match = filename.match(/^([a-z]+)_(kart|bike)(?:_(red|blue))?-([a-z0-9_]+?)(?:_(2|4))?\.szs$/i);
  if (!match) return null;
  const [, code, kind, color, driver, players] = match;
  const mii = driver.match(/^([sml])([abc])_mii_([mf])$/i);
  const character = CHARACTERS[driver] || (mii
    ? `${{ s: 'Small', m: 'Medium', l: 'Large' }[mii[1]]} Mii Outfit ${mii[2].toUpperCase()} (${mii[3].toLowerCase() === 'm' ? 'Male' : 'Female'})`
    : driver);
  const vehicle = VEHICLES[`${code}_${kind}`] || `${code.toUpperCase()} ${kind}`;
  const detail = `${vehicle}${color ? ` (${color})` : ''} - ${players || '1'}P`;
  return { character, detail, search: `${character} ${detail} ${filename}`.toLowerCase() };
}
