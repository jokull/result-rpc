/**
 * SERVER-ONLY: the sqlite driver and the seed. Imported by server.ts and
 * by the server functions the route loaders call — never by anything that
 * reaches the browser bundle.
 *
 * The database lives in a file under the example directory so Vite's
 * separate module environments (client, ssr) and reloads all see one store.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { fileURLToPath } from "node:url";
import { DDL, spots } from "./schema.js";

const DB_PATH = fileURLToPath(new URL("../spots.sqlite", import.meta.url));

const CITIES = ["Kyoto", "Tokyo", "Osaka", "Nara", "Kanazawa", "Hakone"] as const;

const NAMES = [
  "Fushimi Inari at dawn",
  "Nakameguro canal walk",
  "Dotonbori neon crawl",
  "Nara deer park loop",
  "Omicho market breakfast",
  "Lake Ashi pirate ferry",
  "Kiyomizu-dera veranda",
  "Shimokitazawa vinyl dig",
  "Kuromon market skewers",
  "Todai-ji great buddha",
  "Higashi chaya tea house",
  "Open-air museum stroll",
  "Arashiyama bamboo grove",
  "Golden Gai bar hop",
  "Umeda sky escalator",
  "Isuien garden pause",
  "21st Century Museum",
  "Owakudani black eggs",
  "Philosopher's Path bikes",
  "Tsukiji outer market",
  "Shinsekai kushikatsu",
  "Kasuga lantern path",
  "Kenroku-en in the rain",
  "Hakone shrine torii",
  "Gion twilight walk",
  "Yanaka cemetery cats",
  "Osaka castle run",
  "Mount Wakakusa climb",
  "Nagamachi samurai lanes",
  "Sounzan cable car",
] as const;

const seed = (sqlite: Database.Database) => {
  for (const statement of DDL) sqlite.exec(statement);
  const count = sqlite.prepare("SELECT COUNT(*) AS n FROM spots").get() as { n: number };
  if (count.n > 0) return;
  const insert = sqlite.prepare(
    "INSERT INTO spots (id, name, city, description, likes) VALUES (?, ?, ?, ?, ?)",
  );
  const tx = sqlite.transaction(() => {
    NAMES.forEach((name, i) => {
      const id = `spot-${String(i + 1).padStart(2, "0")}`;
      const city = CITIES[i % CITIES.length]!;
      insert.run(
        id,
        name,
        city,
        `A ${city} favorite: ${name.toLowerCase()}. Best before the crowds arrive.`,
        (i * 7) % 23,
      );
    });
  });
  tx();
};

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
seed(sqlite);

export const db = drizzle({ client: sqlite });
export type Db = typeof db;
export { spots };
