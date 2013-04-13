var serverCommon = process.env.SERVER_COMMON;

var cloudStorageUtils = require(serverCommon + '/lib/cloudStorageUtils')
  , conf = require(serverCommon + '/conf')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston


var url = 'https://www.meetmikey.com/domains/www.meetmikey.com/web/content/img/mikey.png';
//var url = 'http://topwalls.net/wallpapers/2012/10/Hulk-Green-2048x2048.jpg';
//var s3Path = conf.aws.s3Folders.static + '/TEMP_TEST';

cloudStorageUtils.downloadAndSaveStaticImage( url, false, function(err) {
  if ( err ) {
    winston.handleError( err );
  } else {
    winston.info('ok!');
  }
});