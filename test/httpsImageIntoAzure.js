var serverCommon = process.env.SERVER_COMMON;

var cloudStorageUtils = require (serverCommon + '/lib/cloudStorageUtils')
    , http = require ('http')
    , conf = require (serverCommon + '/conf')
    , winston = require(serverCommon + '/lib/winstonWrapper').winston


var url = 'http://1800hocking.files.wordpress.com/2011/07/hi-ohio-logo.jpg';
cloudStorageUtils.downloadAndSaveImage( url, true, function (err, path) {
  if (err) {
    winston.doError('test failed', {err: err});
    return;
  }
  winston.doInfo('path', {path: path});
});