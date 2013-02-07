var Diffbot = require('diffbot').Diffbot
  , mailReaderConf = require('../conf')

var diffbot = new Diffbot(mailReaderConf.diffbot.token);
exports.diffbot = diffbot;