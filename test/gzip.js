var serverCommon = process.env.SERVER_COMMON;

var cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , fs = require('fs')

var filePath = 'test/data/fist.png';
var filename = 'fist.png';
var contentType = 'image/png';
var contentEncoding = 'gzip';
var s3Path = '/attachments/GZIP_TEST';

fs.readFile(filePath, function(err, data) {
  if ( err ) {
    winston.doError(err);

  } else {
    var headers = {
        'Content-Type': contentType
      , 'Content-Encoding': contentEncoding
      //, 'Content-Length': data.length
      , "x-amz-server-side-encryption" : "AES256"
      //, "Content-Disposition" : 'attachment; filename=' + filename
    }

    cloudStorageUtils.putBuffer(data, s3Path, headers, true, false, function(err, res) {
      if ( err ) {
        winston.handleError(err);
      } else {
        winston.doInfo('putBuffer successful');
      }
    });
  }
});
