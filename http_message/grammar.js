/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// The message/http wire dialect: the .http grammar with the file-format
// features switched off. All rules live in common/define-grammar.js.
module.exports = require("../common/define-grammar")(true);
