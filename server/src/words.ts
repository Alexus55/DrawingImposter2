export const WORDS = [
  "Tisch", "Katze", "Auto", "Baum", "Haus", "Brot", "Lampe", "Brille", "Fahrrad", "Sonne",
  "Blume", "Schule", "Uhr", "Telefon", "Berg", "Fenster", "Flasche", "Zug", "Stuhl", "Apfel"
];

export const FAKE_WORDS = [
  "Rakete", "Nebel", "Roboter", "Wolke", "Insel", "Pyramide", "Drache", "Magnet", "Stern", "Tiger",
  "Kompass", "Vulkan", "Palme", "Mikrofon", "Traktor", "Anker", "Planet", "Komet", "Klavier", "Tunnel"
];

export function pickWordPair() {
  const realWord = WORDS[Math.floor(Math.random() * WORDS.length)];
  let fakeWord = FAKE_WORDS[Math.floor(Math.random() * FAKE_WORDS.length)];

  if (fakeWord === realWord) {
    fakeWord = FAKE_WORDS[(FAKE_WORDS.indexOf(fakeWord) + 1) % FAKE_WORDS.length];
  }

  return { realWord, fakeWord };
}
