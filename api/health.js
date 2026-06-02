const { getHealth } = require("../lib/chatService");

module.exports = function handler(_req, res) {
  return res.status(200).json(getHealth());
};
