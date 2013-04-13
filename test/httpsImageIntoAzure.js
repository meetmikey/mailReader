var serverCommon = process.env.SERVER_COMMON;

var cloudStorageUtils = require (serverCommon + '/lib/cloudStorageUtils')
    , http = require ('http')
    , conf = require (serverCommon + '/conf');


var url = 'http://1800hocking.files.wordpress.com/2011/07/hi-ohio-logo.jpg';
cloudStorageUtils.downloadAndSaveStaticImage( url, true, function (err, path) {
  if (err) {
    console.error ('test failed', err);
    return;
  }

  console.log ('path', path);
});