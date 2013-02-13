var serverCommon = process.env.SERVER_COMMON;

var urlUtils = require(serverCommon + '/lib/urlUtils')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , fs = require('fs')
  , request = require('request')

var url = 'http://static.usenix.org/events/sec11/tech/slides/mulazzani.pdf';
var filename = '/tmp/pdfOut.pdf';


request( url, {timeout : 10000, encoding : null}, function (error, response, body) {

  if ( error || ( ! response ) || ( response.statusCode !== 200 ) ) {
    winston.doError('error resolving URL');
    
  } else {

    fs.writeFile(filename, response.body, 'binary', function(err) {
      if ( err ) {
        winston.doError(err);
      }
      winston.info('done!');
    });
  }
});