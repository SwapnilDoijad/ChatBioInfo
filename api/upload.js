const { handleUploadRequest } = require("../lib/uploadProxy");

module.exports = async function handler(req, res) {
  return handleUploadRequest(req, res);
};
