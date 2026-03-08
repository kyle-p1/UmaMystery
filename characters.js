(function (root, factory) {
  const payload = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = payload;
  }

  if (typeof window !== "undefined") {
    window.GUESS_WHO_CHARACTERS = payload.characters;
    window.GUESS_WHO_CHARACTER_SOURCE = payload.sourceUrl;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const sourceUrl = "https://umamusu.wiki/List_of_Characters";

  const names = [
    "Admire Groove",
    "Admire Vega",
    "Agnes Digital",
    "Agnes Tachyon",
    "Air Groove",
    "Air Messiah",
    "Air Shakur",
    "Almond Eye",
    "Aston Machan",
    "Bamboo Memory",
    "Believe",
    "Biko Pegasus",
    "Biwa Hayahide",
    "Blast Onepiece",
    "Bubble Gum Fellow",
    "Buena Vista",
    "Calstone Light O",
    "Cesario",
    "Cheval Grand",
    "Chrono Genesis",
    "Copano Rickey",
    "Curren Bouquetd'or",
    "Curren Chan",
    "Daiichi Ruby",
    "Daitaku Helios",
    "Daiwa Scarlet",
    "Dantsu Flame",
    "Daring Heart",
    "Daring Tact",
    "Dream Journey",
    "Duramente",
    "Durandal",
    "Eishin Flash",
    "El Condor Pasa",
    "Epiphaneia",
    "Espoir City",
    "Fenomeno",
    "Fine Motion",
    "Forever Young",
    "Fuji Kiseki",
    "Furioso",
    "Fusaichi Pandora",
    "Gentildonna",
    "Gold City",
    "Gold Ship",
    "Gran Alegria",
    "Grass Wonder",
    "Haru Urara",
    "Hishi Akebono",
    "Hishi Amazon",
    "Hishi Miracle",
    "Hokko Tarumae",
    "Ikuno Dictus",
    "Inari One",
    "Ines Fujin",
    "Jungle Pocket",
    "K.S.Miracle",
    "Katsuragi Ace",
    "Kawakami Princess",
    "King Halo",
    "Kiseki",
    "Kitasan Black",
    "Logotype",
    "Loves Only You",
    "Lucky Lilac",
    "Manhattan Cafe",
    "Marche Lorraine",
    "Maruzensky",
    "Marvelous Sunday",
    "Matikanefukukitaru",
    "Matikanetannhauser",
    "Mayano Top Gun",
    "Meisho Doto",
    "Mejiro Ardan",
    "Mejiro Bright",
    "Mejiro Dober",
    "Mejiro McQueen",
    "Mejiro Palmer",
    "Mejiro Ramonu",
    "Mejiro Ryan",
    "Mihono Bourbon",
    "Mr. C.B.",
    "Nakayama Festa",
    "Narita Brian",
    "Narita Taishin",
    "Narita Top Road",
    "Neo Universe",
    "Nice Nature",
    "Nishino Flower",
    "No Reason",
    "North Flight",
    "Oguri Cap",
    "Orfevre",
    "Red Desire",
    "Rhein Kraft",
    "Rice Shower",
    "Rose Kingdom",
    "Royce and Royce",
    "Rulership",
    "Sakura Bakushin O",
    "Sakura Chitose O",
    "Sakura Chiyono O",
    "Sakura Laurel",
    "Samson Big",
    "Satono Crown",
    "Satono Diamond",
    "Seeking the Pearl",
    "Seiun Sky",
    "Shinko Windy",
    "Silence Suzuka",
    "Sirius Symboli",
    "Smart Falcon",
    "Sounds of Earth",
    "Special Week",
    "Stay Gold",
    "Still in Love",
    "Super Creek",
    "Sweep Tosho",
    "Symboli Kris S",
    "Symboli Rudolf",
    "T.M. Opera O",
    "Taiki Shuttle",
    "Tamamo Cross",
    "Tanino Gimlet",
    "Tap Dance City",
    "Tokai Teio",
    "Tosen Jordan",
    "Transcend",
    "Tsurumaru Tsuyoshi",
    "Twin Turbo",
    "Verxina",
    "Victoire Pisa",
    "Vivlos",
    "Vodka",
    "Win Variation",
    "Winning Ticket",
    "Wonder Acute",
    "Yaeno Muteki",
    "Yamanin Zephyr",
    "Yukino Bijin",
    "Zenno Rob Roy"
  ];

  const hairColors = ["black", "brown", "chestnut", "silver", "blonde", "red", "white"];
  const eyeColors = ["brown", "blue", "green", "hazel", "amber", "violet", "gray"];
  const runningStyles = ["front", "pace", "late", "end"];
  const specialties = ["sprint", "mile", "middle", "long", "dirt"];
  const accessories = ["ribbon", "bow", "cap", "flower", "headband", "none"];

  function hashName(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return hash;
  }

  function slugify(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function buildTraits(name, index) {
    const seed = hashName(`${index}:${name}`);

    return {
      hairColor: hairColors[seed % hairColors.length],
      eyeColor: eyeColors[(seed >> 3) % eyeColors.length],
      runningStyle: runningStyles[(seed >> 6) % runningStyles.length],
      specialty: specialties[(seed >> 8) % specialties.length],
      accessory: accessories[(seed >> 11) % accessories.length],
      glasses: Boolean(seed & 1),
      ribbon: Boolean(seed & 2),
      smile: Boolean(seed & 4)
    };
  }

  const characters = names.map((name, index) => ({
    id: `uma-${String(index + 1).padStart(3, "0")}-${slugify(name)}`,
    name,
    wikiTitle: name,
    traits: buildTraits(name, index),
    source: sourceUrl
  }));

  return {
    sourceUrl,
    characters
  };
});
