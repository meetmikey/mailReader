var serverCommon = process.env.SERVER_COMMON;

var cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , fs = require('fs')

var s3Path = '/attachments/GZIP_TEST';
var filePath = '/tmp/gunzipTest.png';

cloudStorageUtils.getFile( s3Path, true, function(err, res) {

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
      winston.doInfo('done!');
    });
  }
});