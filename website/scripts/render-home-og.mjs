import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { render } from "takumi-js";
import { container, googleFonts, image, text } from "takumi-js/helpers";

const WIDTH = 1200;
const HEIGHT = 630;

const IRIS = "#2e5090";
const CANVAS = "#f6f1e7";
const SKY = "#a8c5d9";

const scriptDirectory = new URL(".", import.meta.url);
const wordmarkPath = new URL("../public/result-rpc-wordmark.svg", scriptDirectory);
const publicOutputPath = new URL("../public/og-home.png", scriptDirectory);
const brandOutputPath = new URL("../../brand/og/result-rpc-og.png", scriptDirectory);

const wordmark = (await readFile(wordmarkPath, "utf8")).replaceAll("#000000", CANVAS);
const wordmarkSource = `data:image/svg+xml;base64,${Buffer.from(wordmark).toString("base64")}`;

const headline = container({
  children: [
    text("Typed RPC for web apps.", {
      color: CANVAS,
      fontFamily: "Space Grotesk",
      fontSize: 82,
      fontWeight: 700,
      letterSpacing: "-0.045em",
      lineHeight: 1,
    }),
    text("Errors stay values across the wire.", {
      color: SKY,
      fontFamily: "Space Grotesk",
      fontSize: 66,
      fontWeight: 700,
      letterSpacing: "-0.045em",
      lineHeight: 1,
      marginTop: 12,
    }),
  ],
  style: {
    display: "flex",
    flexDirection: "column",
  },
});

const card = container({
  children: [
    image({
      alt: "result-rpc",
      height: 64,
      src: wordmarkSource,
      width: 419,
    }),
    headline,
  ],
  style: {
    backgroundColor: IRIS,
    display: "flex",
    flexDirection: "column",
    height: HEIGHT,
    justifyContent: "space-between",
    padding: "76px 80px 82px",
    width: WIDTH,
  },
});

const fonts = await googleFonts([{ name: "Space Grotesk", weight: 700 }]);

const png = await render(card, {
  fonts,
  format: "png",
  height: HEIGHT,
  width: WIDTH,
});

await Promise.all([writeFile(publicOutputPath, png), writeFile(brandOutputPath, png)]);

console.log(
  `Rendered ${WIDTH}x${HEIGHT} Open Graph image:\n- ${fileURLToPath(publicOutputPath)}\n- ${fileURLToPath(brandOutputPath)}\nfrom ${fileURLToPath(wordmarkPath)}`,
);
