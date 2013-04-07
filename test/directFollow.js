var serverComon = process.env.SERVER_COMMON;

var linkHandler = require ('../lib/linkHandler')
    , winston = require (serverComon + '/lib/winstonWrapper').winston;

var linkInfo = {
  "_id" : "515b1eb84e03984f34ab6497", 
  "comparableURL" : "feeds.feedburner.com/~r/typepad/sethsmainblog/~4/uaccfqzhpcw", 
  "comparableURLHash" : "fcd2aa00deb593421759ca0a8c4990c31bb6c92f59dd10d85666672bf922b60f", 
  "followType" : "direct", 
  "indexState" : "hardFail", 
  "lastFollowDate" : "2013-04-02T18:08:56.439Z", 
  "rawURL" : "http://feeds.feedburner.com/~r/typepad/sethsmainblog/~4/UAccfqZhPcw", 
  "resolvedURL" : "http://feeds.feedburner.com/~r/typepad/sethsmainblog/~4/UAccfqZhPcw" 
}


linkInfo = {
  "_id" : "515b1eb84e03984f34ab6497", 
  "comparableURL" : "portal.state.pa.us:80/portal/server.pt/document/1022456/pa_scs_report_web_pdf", 
  "comparableURLHash" : "fcd2aa00deb593421759ca0a8c4990c31bb6c92f59dd10d85666672bf922b60f", 
  "followType" : "direct", 
  "indexState" : "hardFail", 
  "lastFollowDate" : "2013-04-02T18:08:56.439Z", 
  'rawURL' : 'http://www.portal.state.pa.us:80/portal/server.pt/document/1022456/pa_scs_report_web_pdf',
  'resolvedURL' : 'http://www.portal.state.pa.us:80/portal/server.pt/document/1022456/pa_scs_report_web_pdf'
}

linkInfo = {
  "_id" : "515b1eb84e03984f34ab6497", 
  "comparableURL" : "constants.pyuskj", 
  "comparableURLHash" : "fcd2aa00deb593421759ca0a8c4990c31bb6c92f59dd10d85666672bf922b60f", 
  "followType" : "direct", 
  "indexState" : "hardFail", 
  "lastFollowDate" : "2013-04-02T18:08:56.439Z", 
  'rawURL' : "constants.pyuskj",
  'resolvedURL' : "constants.pyuskj"
}

linkInfo = {
  "_id" : "5146d0824e03984f34a8f3a3",
  "comparableURL" : "files.crowdspring.com/entry/3761789_1309898473189053.jpg?awsaccesskeyid=akiai3lsg4zvtvqpowjq&amp;expires=1312848000&amp;signature=xp%2ftixzoheenibgu%2f2w0rybenw4%3d",
  "comparableURLHash" : "2d6e1c1849278f277ae0667d4270ccb4a253d26876cf085857e66eb1f39c2c7d",
  "followType" : "fail",
  "lastFollowDate" : "2013-03-18T08:29:54.966Z",
  "rawURL" : "http://files.crowdspring.com/entry/3761789_1309898473189053.jpg?AWSAccessKeyId=AKIAI3LSG4ZVTVQPOWJQ&amp;Expires=1312848000&amp;Signature=xP%2FtIxZohEENiBGu%2F2w0RYBeNW4%3D"
}


linkHandler.followLinkDirectly (linkInfo, function (err, html, mimeType) {

  if (err) {
    console.log (err)
    winston.handleError (err);
  }
  else if (html) {
    //console.log (html);
    console.log (mimeType);
  }

});