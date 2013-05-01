var serverCommon = process.env.SERVER_COMMON;

var followLinkUtils = require (serverCommon + '/lib/followLinkUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , LinkInfoModel = require(serverCommon + '/schema/linkInfo').LinkInfoModel

//var url = 'http://goo.gl/maps/FRUzo';
var userId = '516c68e0645cc4f018000005';
var linkInfo = new LinkInfoModel();

var linkInfo = {
  "_id" : "517dc7754e03984f34b6a32a",
  "comparableURL" : "fragomen.com/emailmarketing/clickthroughhandler.aspx?link=%3ca+href%3d%22http%3a%2f%2fwww.cbp.gov%2fi94%22%3ehttp%3a%2f%2fwww.cbp.gov%2fi94%3c%2fa%3e&nid=f0c10c7e-214b-4446-9978-7cbe8be871bd&clid=5dc90fc9-8ae6-4e70-9dea-d99821dd2cc4&cid=2b2a8303-71ea-4e1a-b58a-035b95b01c20&ce=jf6hyhuzmbj2oefi7j9mbrka16mikjhvcdmmlinbzdm%3d",
  "comparableURLHash" : "556e0991b005320cf5bc02851fafced4f258b7209bb4fefb3855a3a52fe3f711",
  "rawURL" : "http://www.fragomen.com/EmailMarketing/ClickThroughHandler.aspx?link=%3ca+href%3d%22http%3a%2f%2fwww.cbp.gov%2fI94%22%3ehttp%3a%2f%2fwww.cbp.gov%2fI94%3c%2fa%3e&amp;nid=f0c10c7e-214b-4446-9978-7cbe8be871bd&amp;clid=5dc90fc9-8ae6-4e70-9dea-d99821dd2cc4&amp;cid=2b2a8303-71ea-4e1a-b58a-035b95b01c20&amp;ce=JF6hyhUzMBj2OEFi7j9Mbrka16MiKjHvcdmMLInBzDM%3d"
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
