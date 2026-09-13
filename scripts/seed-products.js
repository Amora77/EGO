// One-time seed of the original static catalog into the products table.
// Safe to re-run: existing rows (matched by id) are left untouched.
const db = require("../db");

const PRODUCTS = [
  {
    id: "ego-hoodie-black",
    name: "EGO Core Hoodie — Black",
    category: "Hoodies",
    price: 6800,
    image: "images/ego-hoodie-black.svg",
    description:
      "Heavyweight 420gsm cotton fleece hoodie with dropped shoulders and an embroidered EGO wordmark. Relaxed, boxy fit.",
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ego-hoodie-stone",
    name: "EGO Core Hoodie — Stone",
    category: "Hoodies",
    price: 6800,
    image: "images/ego-hoodie-stone.svg",
    description:
      "Heavyweight 420gsm cotton fleece hoodie with dropped shoulders and an embroidered EGO wordmark. Relaxed, boxy fit.",
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ego-tee-monogram",
    name: "EGO Monogram Tee",
    category: "T-Shirts",
    price: 3200,
    image: "images/ego-tee-monogram.svg",
    description:
      "Mid-weight 220gsm combed cotton tee with a bold chest monogram print. Garment-dyed for a lived-in feel.",
    sizes: ["S", "M", "L", "XL", "XXL"]
  },
  {
    id: "ego-tee-classic-white",
    name: "EGO Classic Tee — White",
    category: "T-Shirts",
    price: 2800,
    image: "images/ego-tee-classic-white.svg",
    description: "The everyday tee. 220gsm combed cotton, reinforced collar, subtle back-neck EGO tab.",
    sizes: ["S", "M", "L", "XL", "XXL"]
  },
  {
    id: "ego-tee-classic-black",
    name: "EGO Classic Tee — Black",
    category: "T-Shirts",
    price: 2800,
    image: "images/ego-tee-classic-black.svg",
    description: "The everyday tee. 220gsm combed cotton, reinforced collar, subtle back-neck EGO tab.",
    sizes: ["S", "M", "L", "XL", "XXL"]
  },
  {
    id: "ego-jacket-coach",
    name: "EGO Coach Jacket",
    category: "Jackets",
    price: 9800,
    image: "images/ego-jacket-coach.svg",
    description: "Water-resistant shell coach jacket with snap-button placket and embroidered back graphic.",
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ego-jacket-puffer",
    name: "EGO Puffer Jacket",
    category: "Jackets",
    price: 15800,
    image: "images/ego-jacket-puffer.svg",
    description: "Insulated puffer with matte finish shell, storm cuffs, and detachable hood. Built for cold.",
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ego-pants-cargo",
    name: "EGO Utility Cargo Pants",
    category: "Pants",
    price: 7400,
    image: "images/ego-pants-cargo.svg",
    description: "Straight-leg cargo pants in ripstop cotton with reinforced knees and six-pocket utility layout.",
    sizes: ["28", "30", "32", "34", "36"]
  },
  {
    id: "ego-pants-track",
    name: "EGO Track Pants",
    category: "Pants",
    price: 5800,
    image: "images/ego-pants-track.svg",
    description: "Tapered track pants in brushed-back fleece with side stripe detailing and zip ankles.",
    sizes: ["S", "M", "L", "XL"]
  },
  {
    id: "ego-cap-logo",
    name: "EGO Logo Cap",
    category: "Accessories",
    price: 2400,
    image: "images/ego-cap-logo.svg",
    description: "Structured 6-panel cap with embroidered EGO logo and adjustable strap back.",
    sizes: ["One Size"]
  },
  {
    id: "ego-beanie",
    name: "EGO Ribbed Beanie",
    category: "Accessories",
    price: 1800,
    image: "images/ego-beanie.svg",
    description: "Ribbed knit beanie in heavyweight acrylic with woven EGO label.",
    sizes: ["One Size"]
  },
  {
    id: "ego-tote",
    name: "EGO Canvas Tote",
    category: "Accessories",
    price: 1600,
    image: "images/ego-tote.svg",
    description: "Heavy canvas tote with reinforced handles and screen-printed EGO graphic.",
    sizes: ["One Size"]
  }
];

const insert = db.prepare(
  `INSERT OR IGNORE INTO products (id, name, category, price_cents, image, description, sizes)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

let inserted = 0;
for (const p of PRODUCTS) {
  const result = insert.run(p.id, p.name, p.category, p.price, p.image, p.description, JSON.stringify(p.sizes));
  if (result.changes > 0) inserted += 1;
}

console.log(`Seeded ${inserted} new product(s); ${PRODUCTS.length - inserted} already existed.`);
