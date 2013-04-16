var serverCommon = process.env.SERVER_COMMON;

var linkHandler = require ('../lib/linkHandler')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel

var url = 'https://www.newschallenge.org/open/open-government/submission/socialkit-start-your-social-venture/';
var userId = '516c68e0645cc4f018000005';
var linkInfo = new LinkInfoModel();

linkInfo.comparableURLHash = urlUtils.getComparableURLHash( url );
linkInfo.rawURL = url;
linkInfo.comparableURL = urlUtils.getComparableURL( url );

linkHandler.followLink( linkInfo, userId, function(err, a, b, c) {
  if ( err ) {
    winston.handleError(err);

  } else {
    winston.doInfo('callback...', {a: a, b: b, c: c});
  }
});
