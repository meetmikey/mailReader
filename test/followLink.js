var serverCommon = process.env.SERVER_COMMON;

var followLinkUtils = require (serverCommon + '/lib/followLinkUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel

//var url = 'http://goo.gl/maps/FRUzo';
var userId = '516c68e0645cc4f018000005';
var linkInfo = new LinkInfoModel();

var linkInfo = {
  "_id" : "517dc7754e03984f34b6a32a",
  "comparableURL" : "youtube.com/watch?v=KFriB2h03-A",
  "comparableURLHash" : "556e0991b005320cf5bc02851fafced4f258b7209bb4fefb3855a3a52fe3f711",
  "rawURL" : "http://www.youtube.com/watch?v=KFriB2h03-A"
}

//linkInfo.comparableURLHash = urlUtils.getComparableURLHash( url );
//linkInfo.rawURL = url;
//linkInfo.comparableURL = urlUtils.getComparableURL( url );

followLinkUtils.followLink( linkInfo, userId, function(err, a, b, c) {
  if ( err ) {
    winston.handleError(err);

  } else {
    winston.doInfo('callback...', {a: a, b: b, c: c});
  }
});
