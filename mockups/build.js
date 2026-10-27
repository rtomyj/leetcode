// Generates one mockup page per theme from the real index.html.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
for (const css of fs.readdirSync(path.join(__dirname, "themes"))) {
  const html = src
    .replace("</head>", `<link rel="stylesheet" href="themes/${css}">\n</head>`)
    .replace('<script src="problems.js">', '<script src="seed.js"></script>\n<script src="../problems.js">')
    .replace('<script src="srs.js">', '<script src="../srs.js">')
    .replace('<script src="app.js">', '<script src="../app.js">');
  fs.writeFileSync(path.join(__dirname, css.replace(".css", ".html")), html);
}
