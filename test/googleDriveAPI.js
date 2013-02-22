var serverCommon = process.env.SERVER_COMMON;

var request = require('request')
  , winston = require(serverCommon + '/lib/winstonWrapper').winston
  , cheerio = require('cheerio')
  , linkHandler = require('../lib/linkHandler')

//var googleDocId = '1uwqBMvdgQfmGzrTxps3oPcqEf45U7-xNniGEpsk0bAQ';
var googleDocId = '1CTNXkbYe_XIpFFb7qvEP0IVLEBxjBJye5-gEIGtFQhE'; //form

var accessToken = 'ya29.AHES6ZQHvsyPurWX6pi5-qGqJB3cyF9eJ1cPoV_-QnZdfqA';

var docURL = 'https://www.googleapis.com/drive/v2/files/' + googleDocId + '?access_token=' + accessToken;

var directDocURL = 'https://docs.google.com/feeds/download/documents/export/Export?id=' + googleDocId + '&exportFormat=html' + '&access_token=' + accessToken;
console.log('url: ' + directDocURL);

request( directDocURL, function(err, response, html) {
  if ( err ) {
    winston.doError('request error', {err: err});

  } else if ( ! html ) {
    winston.doError('no html')

  } else {
    winston.doInfo('html', {html:html});
    var title = linkHandler.extractTitleFromHTML( html );
    var summary = linkHandler.extractSummaryFromHTML( html );
    winston.doInfo('title', {title: title});
    winston.doInfo('summary', {summary: summary});
  }
});

/*
request( docURL, function(err, response, body) {
  if ( err ) {
    winston.doError('request error', {err: err});

  } else if ( ! body ) {
    winston.doError('no body')

  } else {
    //winston.doInfo('body', {body:body});

    try {
      bodyJSON = JSON.parse(body);
    } catch ( exception ) {
      winston.doError('exception parsing body');
      return;
    }

    //console.log('bodyJSON', bodyJSON);
    var title = bodyJSON["title"];
    winston.doInfo('title', {title: title});

    var exportLinks = bodyJSON.exportLinks;
    if ( exportLinks && exportLinks['text/html'] ) {
      var docHTMLURL = exportLinks['text/html'] + '&access_token=' + accessToken;
      winston.doInfo('docHTMLURL', {docHTMLURL: docHTMLURL});
      request( docHTMLURL, function( docHTMLErr, docHTMLResponse, docHTMLBody ) {
        if ( err ) {
          winston.doError('docHTML request error', {docHTMLErr: docHTMLErr});

        } else if ( ! docHTMLBody ) {
          winston.doError('no docHTMLBody')

        } else {
          winston.doInfo('doc html', {docHTMLBody: docHTMLBody});
        }
      });
    }
  }
});
*/