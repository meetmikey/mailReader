var diffbot = require('../lib/diffbotWrapper').diffbot;

var url = "http://www.elasticsearch.org/videos/2012/06/05/big-data-search-and-analytics.html";

var diffbotData = {
  uri: url
  , summary: true
  , tags: false
  , stats: true
}

diffbot.article( diffbotData, function(err, response) {

if ( err || ( ! response ) || ( response.errorCode ) ) {
  var warnData = {err: err, response: response, url: url};
  if ( response ) {
    warnData['responseErrorCode'] = response.errorCode;
  }
  console.log ('linkHandler: followDiffbotLink: diffbot failed', warnData);
  console.log (response)

    // TODO: check why there was a failure before following directly
  }
  else {
    console.log (response)

  }
});