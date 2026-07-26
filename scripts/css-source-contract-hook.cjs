const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const { syncBuiltinESMExports } = require("node:module");
const { isFacade, readEffectiveCssSync } = require("./css-source-contract.cjs");

const readFileSync = fs.readFileSync.bind(fs);
const readFile = fsPromises.readFile.bind(fsPromises);

fs.readFileSync = function patchedReadFileSync(input, options) {
  return isFacade(input) ? readEffectiveCssSync(input, options) : readFileSync(input, options);
};

fsPromises.readFile = async function patchedReadFile(input, options) {
  return isFacade(input) ? readEffectiveCssSync(input, options) : readFile(input, options);
};

syncBuiltinESMExports();
