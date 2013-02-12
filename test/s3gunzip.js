var serverCommon = process.env.SERVER_COMMON;

var s3Utils = require(serverCommon + '/lib/s3Utils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , fs = require('fs')

var s3Path = '/attachments/GZIP_TEST';
var filePath = '/tmp/gunzipTest.png';

s3Utils.getFile( s3Path, function(err, res) {

  if ( err ) {
    winston.doError( err );
    
  } else if ( ! res ) {
    winston.handlError( winston.makeMissingParamError('res') );

  } else {

    var writeStream = fs.createWriteStream(filePath);

    res.on('data', function(data) {
      writeStream.write(data);
    });
    res.on('end', function() {
      writeStream.end();
      winston.info('done!');
    });
  }
});