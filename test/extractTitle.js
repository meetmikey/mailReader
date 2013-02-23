var serverCommon = process.env.SERVER_COMMON;

var cheerio = require('cheerio')
  , fs = require('fs')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , linkHandler = require('../lib/linkHandler')

var filename = './test/data/mindSumo.html';
//var filename = './test/data/titleTest.html';

fs.readFile( filename, 'utf8', function(err, data) {
  if ( err ) {
    winston.doError('error reading file', {err: err});

  } else {
    var title = linkHandler.extractTitleFromHTML( data );
    winston.doInfo('title',{title:title});
  }
});