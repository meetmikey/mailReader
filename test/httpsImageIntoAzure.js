var serverCommon = process.env.SERVER_COMMON;
var azureUtils = require (serverCommon + '/lib/azureUtils')
    , http = require ('http')
    , conf = require (serverCommon + '/conf');


azureUtils.downloadAndSaveStaticImage('http://1800hocking.files.wordpress.com/2011/07/hi-ohio-logo.jpg', function (err, path) {
  if (err) {
    console.error ('test failed', err);
    return;
  }

  console.log ('path', path);
});